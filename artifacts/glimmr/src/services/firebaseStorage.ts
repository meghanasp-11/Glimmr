import {
  ref,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  listAll,
  UploadMetadata,
  UploadTaskSnapshot,
} from 'firebase/storage';
import { getStorageService } from '../lib/firebase';

/**
 * Upload a file to Firebase Storage
 * @param file - File to upload
 * @param path - Storage path (e.g., 'places/images/filename.jpg')
 * @param metadata - Optional metadata
 * @returns Promise with download URL
 */
export const uploadFile = async (
  file: File,
  path: string,
  metadata?: UploadMetadata
): Promise<string> => {
  const storageRef = ref(getStorageService(), path);
  const snapshot = await uploadBytes(storageRef, file, metadata);
  const downloadURL = await getDownloadURL(snapshot.ref);
  return downloadURL;
};

/**
 * Upload with progress tracking (useful for large files)
 * @param file - File to upload
 * @param path - Storage path
 * @param onProgress - Callback with progress percentage
 * @param metadata - Optional metadata
 * @returns Promise with download URL
 */
export const uploadFileWithProgress = (
  file: File,
  path: string,
  onProgress: (progress: number) => void,
  metadata?: UploadMetadata
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const storageRef = ref(getStorageService(), path);
    const uploadTask = uploadBytesResumable(storageRef, file, metadata);

    uploadTask.on(
      'state_changed',
      (snapshot: UploadTaskSnapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        onProgress(progress);
      },
      (error) => {
        reject(error);
      },
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        resolve(downloadURL);
      }
    );
  });
};

/**
 * Delete a file from Firebase Storage
 * @param path - Storage path to the file
 */
export const deleteFile = async (path: string): Promise<void> => {
  const storageRef = ref(getStorageService(), path);
  await deleteObject(storageRef);
};

/**
 * Get download URL for a file
 * @param path - Storage path
 * @returns Promise with download URL
 */
export const getFileURL = async (path: string): Promise<string> => {
  const storageRef = ref(getStorageService(), path);
  return await getDownloadURL(storageRef);
};

/**
 * List all files in a directory
 * @param path - Directory path
 * @returns Promise with array of file references
 */
export const listFiles = async (path: string) => {
  const storageRef = ref(getStorageService(), path);
  const result = await listAll(storageRef);
  return result.items;
};

/**
 * Upload multiple files at once
 * @param files - Array of files to upload
 * @param basePath - Base path for storage (e.g., 'places/images/')
 * @returns Promise with array of download URLs
 */
export const uploadMultipleFiles = async (
  files: File[],
  basePath: string
): Promise<string[]> => {
  const uploadPromises = files.map((file) => {
    const path = `${basePath}${file.name}`;
    return uploadFile(file, path);
  });
  return await Promise.all(uploadPromises);
};
