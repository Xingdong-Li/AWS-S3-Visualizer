import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Link as ReactRouterLink, useSearchParams } from "react-router-dom";
import {
  Box,
  Stack,
  VStack,
  Heading,
  Text,
  Link,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Spinner,
  Icon,
  Input,
  Button,
  Checkbox,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
} from "@chakra-ui/react";
import { GrHome, GrFolder, GrDocument, GrFormNext } from "react-icons/gr";
import {
  useContents,
  useCreateFolder,
  useDeleteFiles,
  useUploadFile,
  useDefaultFolders,
  useRenameFile,
} from "../hooks/useS3System";
import { sanitizePrefix, formatFileSize } from "../helpers";
function getPrefix(searchParams, defaultPrefix) {
  let searchPath = searchParams.get("prefix");
  if (!searchPath) return sanitizePrefix(decodeURIComponent(defaultPrefix));
  searchPath = decodeURIComponent(searchPath);
  console.log(`searchPath: ${searchPath}`);
  return sanitizePrefix(
    searchPath.includes(defaultPrefix) ? searchPath : defaultPrefix
  );
}
const bucketName = import.meta.env.VITE_BUCKET_NAME;
export default function Explorer({ userId, userName }) {
  const [searchParams] = useSearchParams();
  const prefix = getPrefix(searchParams, `${userId}-${userName}/`);
  // const defaultFoldersMutation = useDefaultFolders(`${userId}-${userName}/`);

  useEffect(() => {
    document.title = bucketName;
    // defaultFoldersMutation.mutate();
  }, []);

  return (
    // Outer box to center the content
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      width="full"
    >
      {/* Inner box to constrain the maximum width and manage padding */}
      <Box width="full" maxW="4xl" p={3}>
        <VStack alignItems="left">
          <Navigation prefix={prefix} />
          <Listing prefix={prefix} />
        </VStack>
      </Box>
    </Box>
  );
}

function Navigation({ prefix }) {
  const folders = prefix
    .split("/")
    .slice(0, -1)
    .map((item, index, items) => ({
      name: `${item}/`,
      url: `/?prefix=${items.slice(0, index + 1).join("/")}/`,
      isCurrent: index == items.length - 1,
    }));

  return (
    <Breadcrumb
      borderWidth="1px"
      shadow="md"
      p={3}
      background="gray.100"
      spacing={1}
      separator={<Icon as={GrFormNext} verticalAlign="middle" />}
    >
      <BreadcrumbItem key="root" isCurrentPage={folders.length == 0}>
        {folders.length == 0 ? (
          <Text color="gray.400">
            <Icon as={GrHome} mr={2} verticalAlign="text-top" />
            {bucketName}
          </Text>
        ) : (
          <BreadcrumbLink as={ReactRouterLink} to="" aria-label="bucket root">
            <Icon as={GrHome} verticalAlign="text-top" />
          </BreadcrumbLink>
        )}
      </BreadcrumbItem>
      {folders.map((item) => (
        <BreadcrumbItem key={item.url} isCurrentPage={item.isCurrent}>
          {item.isCurrent ? (
            <Text color="gray.400">{item.name}</Text>
          ) : (
            <BreadcrumbLink as={ReactRouterLink} to={item.url}>
              {item.name}
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
      ))}
    </Breadcrumb>
  );
}

Navigation.propTypes = {
  prefix: PropTypes.string,
};

function Listing({ prefix }) {
  useEffect(() => {
    setSelectedFiles([]);
  }, [prefix]);
  const { status, data, error } = useContents(prefix);
  console.log("data:", data);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const createFolderMutation = useCreateFolder();
  const [newFolderName, setNewFolderName] = useState("");
  const deleteFilesMutation = useDeleteFiles();

  const uploadFileMutation = useUploadFile();
  const [file, setFile] = useState(null);

  const [newFilename, setNewFilename] = useState("");
  const renameMutation = useRenameFile();
  const {
    isOpen: isCreateOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
  } = useDisclosure();
  const {
    isOpen: isUploadOpen,
    onOpen: onUploadOpen,
    onClose: onUploadClose,
  } = useDisclosure();
  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
  } = useDisclosure();
  const {
    isOpen: isRenameOpen,
    onOpen: onRenameOpen,
    onClose: onRenameClose,
  } = useDisclosure();

  const handleFileSelection = (key) => {
    setSelectedFiles((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key);
      } else {
        return [...prev, key];
      }
    });
  };

  const handleDeleteSelectedFiles = () => {
    if (selectedFiles.length === 0) {
      alert("No items selected for deletion.");
      return;
    }
    console.log(`Deleting: ${selectedFiles}`);

    for (let i = 0; i < selectedFiles.length; i++) {
      const item = selectedFiles[i];
      deleteFilesMutation.mutate(item, {
        onSuccess: () => {
          console.log(`Deleted: ${item}`);
        },
        onError: (error) => {
          // Display error message to the user
          alert(error.message);
        },
        onSettled: () => {
          if (i === selectedFiles.length - 1) {
            setSelectedFiles([]);
            onDeleteClose();
          }
        },
      });
    }
  };

  const handleCreateFolder = () => {
    createFolderMutation.mutate(
      { folderName: newFolderName, currentPrefix: prefix },
      {
        onError: (error) => {
          // Display error message to the user
          alert(error.message);
        },
        onSettled: () => {
          // Optionally, clear the input on completion
          setNewFolderName("");
          onCreateClose();
        },
      }
    );
  };

  const handleFileChange = (event) => {
    setFile(event.target.files[0]);
  };

  const handleUpload = () => {
    if (!file) {
      alert("Please select a file first.");
      return;
    }
    uploadFileMutation.mutate(
      {
        file,
        prefix: prefix,
      },
      {
        onError: (error) => {
          // Display error message to the user
          alert(error.message);
        },
        onSettled: () => {
          // Optionally, clear the input on completion
          onUploadClose();
        },
      }
    );
  };

  function getFileName(path) {
    // It's a folder
    if (path.endsWith("/")) {
      return path.split("/").slice(-2, -1)[0];
    }
    return path.split("/").slice(-1)[0];
  }

  return (
    <>
      {/* Create Folder Modal */}
      <Modal isOpen={isCreateOpen} onClose={onCreateClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Create a New Folder</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Input
              placeholder="Folder Name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="blue"
              mr={3}
              onClick={handleCreateFolder}
              isLoading={createFolderMutation.isLoading}
            >
              Create
            </Button>
            <Button onClick={onCreateClose}>Cancel</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Upload Files Modal */}
      <Modal isOpen={isUploadOpen} onClose={onUploadClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Upload Files</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            {/* File input component should go here */}
            <Input type="file" onChange={handleFileChange} multiple />
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="blue"
              mr={3}
              onClick={handleUpload}
              isLoading={uploadFileMutation.isLoading}
            >
              Upload
            </Button>
            <Button onClick={onUploadClose}>Cancel</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Rename File Modal */}
      <Modal isOpen={isRenameOpen} onClose={onRenameClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Rename File</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Input
              placeholder="New File Name"
              value={newFilename}
              onChange={(e) => setNewFilename(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="blue"
              mr={3}
              onClick={() => {
                if (selectedFiles.length !== 1) {
                  alert("Please select a single file to rename.");
                  return;
                }
                renameMutation.mutate(
                  {
                    oldKey: getFileName(selectedFiles[0]),
                    newKey: newFilename,
                    isFolder: selectedFiles[0].endsWith("/"),
                    currentPrefix: prefix,
                  },
                  {
                    onError: (error) => {
                      // Display error message to the user
                      alert(error.message);
                    },
                    onSettled: () => {
                      // Optionally, clear the input on completion
                      setNewFilename("");
                      setSelectedFiles([]);
                      onRenameClose();
                    },
                  }
                );
              }}
              isLoading={renameMutation.isLoading}
              isDisabled={newFilename === ""}
            >
              Rename
            </Button>
            <Button onClick={onRenameClose}>Cancel</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm Deletion</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            Are you sure you want to delete the selected files?
          </ModalBody>
          <ModalFooter>
            <Button
              colorScheme="red"
              mr={3}
              onClick={handleDeleteSelectedFiles}
            >
              Delete
            </Button>
            <Button onClick={onDeleteClose}>Cancel</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Heading as="h3" size="lg" mt={2} mb={2} fontWeight="light">
        {`${prefix.split("/").slice(-2, -1)}/`}
      </Heading>
      <Box mb={4}>
        <Stack direction="row" spacing={8}>
          <Button onClick={onCreateOpen}>Create Folder</Button>
          <Button onClick={onUploadOpen}>Upload Files</Button>
          <Button
            onClick={() => {
              setNewFilename(getFileName(selectedFiles[0]));
              onRenameOpen();
            }}
            isDisabled={selectedFiles.length !== 1}
          >
            Rename File
          </Button>
          <Button
            onClick={onDeleteOpen}
            colorScheme="red"
            isDisabled={selectedFiles.length === 0}
          >
            Delete Files
          </Button>
        </Stack>
      </Box>
      <Box borderWidth="1px" shadow="md">
        <Table variant="simple" size="sm">
          <Thead background="gray.200">
            <Tr>
              <Th>
                <Checkbox
                  sx={{
                    ".chakra-checkbox__control": {
                      borderColor: "black", // Adds a border color
                    },
                  }}
                  isChecked={
                    selectedFiles.length ===
                    data?.objects?.length + data?.folders?.length
                  }
                  onChange={(e) =>
                    setSelectedFiles(
                      e.target.checked
                        ? [...data?.objects, ...data?.folders].map(
                            (item) => item.path
                          )
                        : []
                    )
                  }
                />
              </Th>
              <Th>Name</Th>
              <Th>Last modified</Th>
              <Th>Size</Th>
            </Tr>
          </Thead>
          <Tbody>
            {(() => {
              switch (status) {
                case "loading":
                  return (
                    <Tr>
                      <Td colSpan={3} textAlign="center">
                        <Spinner
                          size="sm"
                          emptyColor="gray.200"
                          verticalAlign="middle"
                          mr={1}
                        />
                        Loading...
                      </Td>
                    </Tr>
                  );
                case "error":
                  return (
                    <Tr>
                      <Td colSpan={3} textAlign="center">
                        Failed to fetch data: {error.message}
                      </Td>
                    </Tr>
                  );
                case "success":
                  return (
                    <>
                      {data?.folders.map((item) => (
                        <Tr key={item.path}>
                          <Td>
                            <Checkbox
                              isChecked={selectedFiles.includes(item.path)}
                              onChange={() => handleFileSelection(item.path)}
                            />
                          </Td>
                          <Td>
                            <Icon
                              as={GrFolder}
                              mr={1}
                              verticalAlign="text-top"
                            />
                            <Link
                              as={ReactRouterLink}
                              to={`/?prefix=${encodeURIComponent(item.path)}`}
                            >
                              {item.name}
                            </Link>
                          </Td>
                          <Td>–</Td>
                          <Td isNumeric>–</Td>
                        </Tr>
                      ))}
                      {data?.objects.map((item) => (
                        <Tr key={item.path}>
                          <Td>
                            <Checkbox
                              isChecked={selectedFiles.includes(item.path)}
                              onChange={() => handleFileSelection(item.path)}
                            />
                          </Td>
                          <Td>
                            <Icon
                              as={GrDocument}
                              mr={1}
                              verticalAlign="text-top"
                            />
                            <Link href={item.url} isExternal>
                              {item.name}
                            </Link>
                          </Td>
                          <Td>{item.lastModified.toLocaleString()}</Td>
                          <Td isNumeric>{formatFileSize(item.size)}</Td>
                        </Tr>
                      ))}
                    </>
                  );
              }
            })()}
          </Tbody>
        </Table>
      </Box>
    </>
  );
}

Listing.propTypes = {
  prefix: PropTypes.string,
};
