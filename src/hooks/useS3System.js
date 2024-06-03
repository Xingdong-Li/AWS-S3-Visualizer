import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import mime from "mime";
const s3Client = new S3Client({
  region: import.meta.env.VITE_AWS_REGION,
  credentials: {
    accessKeyId: import.meta.env.VITE_AWS_ACCESS_KEY_ID,
    secretAccessKey: import.meta.env.VITE_AWS_SECRET_ACCESS_KEY,
  },
});

const excludeRegex = new RegExp(import.meta.env.VITE_EXCLUDE_PATTERN || /(?!)/);
const bucketName = import.meta.env.VITE_BUCKET_NAME;
const defaultFolders = [
  "Health records",
  "Contractual agreements",
  "Bills & Receipts",
  "Financial documents",
  "Care payments",
  "Advance care planning",
  "Legal documents",
];

const ensureDefaultFoldersExist = async (prefix) => {
  console.log("Ensuring default folders exist", prefix);
  // Fetch the existing folders
  const existingFolders = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      Delimiter: "/",
    })
  );

  const existingFolderNames = new Set(
    existingFolders.CommonPrefixes?.map((cp) =>
      cp.Prefix.replace(prefix, "").replace("/", "")
    )
  );
  console.log("Existing folders:", existingFolderNames);

  // Check and create missing folders
  for (const folder of defaultFolders) {
    if (!existingFolderNames.has(folder)) {
      // Folder does not exist, create it
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: `${prefix}${folder}/`,
        })
      );
      console.log(`Created folder: ${folder}`);
    }
  }
};

// Make sure the default folders exist when the app starts
export const useDefaultFolders = (prefix) => {
  const queryClient = useQueryClient();
  return useMutation(() => ensureDefaultFoldersExist(prefix), {
    onSuccess: () => {
      console.log("Ensured default folders existed");
      queryClient.invalidateQueries(["contents"]);
    },
    onError: (error) => {
      console.error("Error ensuring default folders exist:", error);
    },
  });
};

const listContents = async (prefix) => {
  console.debug("Retrieving data from AWS SDK");
  const data = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      Delimiter: "/",
    })
  );
  const filteredContents =
    data.Contents?.filter(
      ({ Key, Size }) => !(Size === 0 && Key.endsWith("/"))
    ) || [];
  console.log(`Listing prefix: ${prefix}`);
  // console.log(prefix === "");
  console.log(`Received data: ${JSON.stringify(data, null, 2)}`);
  return {
    folders:
      data.CommonPrefixes?.filter(
        ({ Prefix }) => !excludeRegex.test(Prefix)
      ).map(({ Prefix }) => ({
        name: Prefix.slice(prefix.length),
        path: Prefix,
        url: `/?prefix=${Prefix}`,
      })) || [],
    objects:
      filteredContents
        .filter(({ Key }) => !excludeRegex.test(Key))
        .map(({ Key, LastModified, Size }) => ({
          name: Key.slice(prefix.length),
          lastModified: LastModified,
          size: Size,
          path: Key,
          url: `https://${bucketName}.s3.amazonaws.com/${encodeURIComponent(Key)}`,
        })) || [],
  };
};
// Retrieve the contents of the specified prefix
export const useContents = (prefix) => {
  return useQuery(["contents", prefix], () => listContents(prefix));
};

const isValidFileName = (fileName) => {
  // Basic validation: check if the file name is not empty and does not contain illegal characters
  return fileName && /^[\w,\s-]+\.[A-Za-z]{3}$/.test(fileName.trim());
};

const isValidFolderName = (folderName) => {
  return (
    folderName &&
    /^[^\s^\x00-\x1f\\?*:"";<>|\/.][^\x00-\x1f\\?*:"";<>|\/]*[^\s^\x00-\x1f\\?*:"";<>|\/.]+$/g.test(
      folderName.trim()
    )
  );
};

const createFolder = async ({ folderName, currentPrefix }) => {
  console.log(`currentPrefix: ${currentPrefix}`);
  console.log(`Creating folder: ${folderName}`);
  if (!isValidFolderName(folderName)) {
    throw new Error(
      "Invalid folder name!"
    );
  }

  // Construct the full path for the new folder ensuring it ends with a '/'
  const fullPath = `${currentPrefix}${folderName.trim()}/`;

  console.debug(`Creating new folder at: ${fullPath}`);

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: fullPath,
      })
    );
    console.debug("Folder created successfully");
  } catch (error) {
    console.error("Error creating folder:", error);
    throw error; // Re-throw to handle it in the UI component
  }
};
// Handle folder creation
export const useCreateFolder = () => {
  const queryClient = useQueryClient();

  return useMutation(createFolder, {
    onSuccess: () => {
      // Optionally refetch the contents list to reflect the new folder
      queryClient.invalidateQueries(["contents"]);
    },
    onError: (error) => {
      console.error("Error deleting folder and its contents:", error);
    },
  });
};

const copyFolderContents = async (sourcePrefix, destinationPrefix) => {
  // Initialize the marker to handle pagination
  let continuationToken = null;

  do {
    const listParams = {
      Bucket: bucketName,
      Prefix: sourcePrefix,
      ContinuationToken: continuationToken,
    };

    const listedObjects = await s3Client.send(
      new ListObjectsV2Command(listParams)
    );

    // Copy each object found in the current list segment
    for (const object of listedObjects.Contents) {
      const newObjectKey = object.Key.replace(sourcePrefix, destinationPrefix);
      await s3Client.send(
        new CopyObjectCommand({
          Bucket: bucketName,
          CopySource: `${bucketName}/${object.Key}`,
          Key: newObjectKey,
        })
      );
    }

    // If the response is truncated, set the token to get the next segment
    continuationToken = listedObjects.NextContinuationToken;
  } while (continuationToken);
};

const copyFileOrFolders = async (sourceKey, destinationKey) => {
  console.log("Copying file or folder:", sourceKey, destinationKey);

  // Check if it's a folder by looking for a '/' at the end of the key
  if (sourceKey.endsWith("/")) {
    // Recursive copy of folder contents
    await copyFolderContents(sourceKey, destinationKey);
  } else {
    // It's a single file, perform the copy
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: `${bucketName}/${sourceKey}`,
        Key: destinationKey,
      })
    );
  }
};

const deleteFolderAndContents = async (prefix) => {
  // List all objects in the folder
  const listedObjects = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
    })
  );

  if (listedObjects.Contents.length === 0) return;

  // Prepare delete parameters
  const deleteParams = {
    Bucket: bucketName,
    Delete: {
      Objects: listedObjects.Contents.map((obj) => ({ Key: obj.Key })),
    },
  };

  // Delete all objects
  await s3Client.send(new DeleteObjectsCommand(deleteParams));

  // Check if more objects to delete (if response is truncated)
  if (listedObjects.IsTruncated) await deleteFolderAndContents(prefix);
};
//Handle folder deletion
export const useDeleteFiles = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (prefix) => deleteFolderAndContents(prefix),
    onSuccess: () => {
      queryClient.invalidateQueries(["contents"]);
    },
    onError: (error) => {
      console.error("Error deleting folder and its contents:", error);
    },
  });
};

const uploadFileToS3 = async (file, prefix) => {
  const key = `${prefix}${file.name}`;
  const contentType = mime.getType(file.name);
  try {
    const result = await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file,
        ContentType: contentType, // Set the Content-Type based on the file type
      })
    );
    console.log("Successfully uploaded file: ", result);
    return result;
  } catch (error) {
    console.error("Error uploading file: ", error);
    throw error;
  }
};
// Handle file upload
export const useUploadFile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, prefix }) => uploadFileToS3(file, prefix),
    onSuccess: () => {
      // Invalidate and refetch data to update the UI after a successful upload
      queryClient.invalidateQueries(["contents"]);
    },
    onError: (error) => {
      console.error("Error uploading file:", error);
    },
  });
};

async function checkIfFileExists(key) {
  // Check if the newKey already exists
  const checkExistence = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: key,
      MaxKeys: 1,
    })
  );

  if (checkExistence.Contents?.length > 0) {
    throw new Error("The destination file or folder already exists.");
  }
}

const renameFile = async (oldKey, newKey, isFolder, currentPrefix) => {
  console.log("Renaming file:", oldKey, newKey, isFolder, currentPrefix);
  if (!oldKey || !newKey) {
    throw new Error("New filename must be provided");
  }
  if (oldKey === newKey) {
    console.log("Old and new key are the same, no need to rename");
    return;
  }

  if (isFolder) {
    if (!isValidFolderName(newKey)) {
      throw new Error("Invalid folder name");
    }
    oldKey = `${currentPrefix}${oldKey}/`;
    newKey = `${currentPrefix}${newKey}/`;
    await checkIfFileExists(newKey);
    // List all objects in the old folder
    const listedObjects = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: oldKey,
      })
    );
    for (const obj of listedObjects.Contents) {
      const newObjectKey = obj.Key.replace(oldKey, newKey);
      await copyFileOrFolders(obj.Key, newObjectKey);
    }
  } else {
    if (!isValidFileName(newKey)) {
      throw new Error("Invalid file name");
    }
    oldKey = `${currentPrefix}${oldKey}`;
    newKey = `${currentPrefix}${newKey}`;
    await checkIfFileExists(newKey);
    await copyFileOrFolders(oldKey, newKey);
  }
  await deleteFolderAndContents(oldKey);
};

export const useRenameFile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ oldKey, newKey, isFolder, currentPrefix }) =>
      renameFile(oldKey, newKey, isFolder, currentPrefix),
    onSuccess: () => {
      // Invalidate queries to refresh the data
      queryClient.invalidateQueries(["contents"]);
    },
  });
};
