import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon } from '@heroicons/react/outline';
import format from 'date-fns/format';

import config from '@/lib/config';
import { InstantApp } from '@/lib/types';
import { jsonFetch } from '@/lib/fetch';
import { Button, Checkbox, cn, SectionHeading } from '@/components/ui';
import { TokenContext } from '@/lib/contexts';

type StorageObject = {
  key: string;
  size: number;
  owner: string;
  etag: string;
  last_modified: number;
};

type StorageFile = {
  id: string;
  key: string;
  etag: string;
  size: number;
  path: string;
  name: string;
  lastModified: number;
};

type StorageDirectory = {
  name: string;
  size: number;
  lastModified: number;
};

async function fetchStorageFiles(
  token: string,
  appId: string,
  subdirectory?: string
): Promise<StorageObject[]> {
  const qs = subdirectory ? `?subdirectory=${subdirectory}` : '';
  const { data } = await jsonFetch(
    `${config.apiURI}/dash/apps/${appId}/storage/files${qs}`,
    {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    }
  );

  return data;
}

async function deleteStorageFile(
  token: string,
  appId: string,
  filename: string
): Promise<any> {
  const { data } = await jsonFetch(
    `${config.apiURI}/dash/apps/${appId}/storage/files?filename=${filename}`,
    {
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    }
  );

  return data;
}

async function fetchDownloadUrl(
  token: string,
  appId: string,
  filename: string
): Promise<string> {
  const { data } = await jsonFetch(
    `${config.apiURI}/dash/apps/${appId}/storage/signed-download-url?filename=${filename}`,
    {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    }
  );

  return data;
}

async function upload(
  token: string,
  appId: string,
  file: File
): Promise<boolean> {
  const fileName = file.name;
  const { data: presignedUrl } = await jsonFetch(
    `${config.apiURI}/dash/apps/${appId}/storage/signed-upload-url`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ app_id: appId, filename: fileName }),
    }
  );

  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  return response.ok;
}

const formatObjectKey = (file: StorageFile) =>
  [file.path, file.name].filter((str) => !!str).join('/');

function useStorageFiles(
  token: string,
  appId: string,
  subdirectory: string = ''
): [StorageFile[], StorageDirectory[], boolean, any, () => Promise<void>] {
  const [isLoading, setIsLoading] = useState(true);
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [error, setError] = useState<any | null>(null);

  const refresh = useCallback(async () => {
    if (!appId || !token) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const files = await fetchStorageFiles(token, appId, subdirectory);
      const formatted = files.map((f) => {
        const [appId, ...keys] = f.key.split('/');
        const name = keys[keys.length - 1];

        return {
          id: f.key,
          key: f.key,
          path: keys.slice(0, -1).join('/'),
          name: name,
          etag: f.etag,
          size: f.size,
          lastModified: f.last_modified,
        };
      });

      setFiles(formatted);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [token, appId, subdirectory]);

  useEffect(() => {
    refresh();
    // Poll for new files every 2s
    const i = setInterval(() => refresh(), 2000);

    return () => clearInterval(i);
  }, [token, appId, subdirectory]);

  const filesByDirectory = useMemo(
    () =>
      files
        .filter((f) => f.path.startsWith(subdirectory))
        .reduce((acc, f) => {
          // check if the file is in a subdirectory --
          // if yes, group by that directory; if no, group with `$current` directory
          const [directory = ''] = f.path
            .replace(subdirectory, '')
            .split('/')
            .filter((str) => str.length > 0);
          const key = directory.trim().length === 0 ? '$current' : directory;

          return { ...acc, [key]: (acc[key] || []).concat(f) };
        }, {} as Record<string, StorageFile[]>),
    [files, subdirectory]
  );
  const directories = useMemo(() => {
    return Object.entries(filesByDirectory)
      .filter(([key]) => key !== '$current')
      .map(([name, files]) => {
        return {
          name,
          size: files.reduce((total, f) => total + f.size, 0),
          lastModified: Math.max(...files.map((f) => f.lastModified)),
        };
      })
      .sort((a, b) => b.lastModified - a.lastModified);
  }, [filesByDirectory]);
  const currentFiles = (filesByDirectory.$current || []).sort(
    (a, b) => b.lastModified - a.lastModified
  );

  return [currentFiles, directories, isLoading, error, refresh];
}

export function StorageTab({
  className,
  app,
}: {
  className?: string;
  app: InstantApp;
}) {
  const token = useContext(TokenContext);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [subdirectoryPrefix, setSubdirectoryPrefix] = useState<string>('');
  const [
    files = [],
    directories = [],
    isLoadingFiles,
    filesError,
    refreshFiles,
  ] = useStorageFiles(token, app.id, subdirectoryPrefix);
  const breadcrumbs = [
    '/[root]',
    ...subdirectoryPrefix.split('/').filter((str) => !!str),
  ];

  const handleUploadFile = async () => {
    if (selectedFiles.length === 0) {
      return;
    }

    const [file] = selectedFiles;
    const success = await upload(token, app.id, file);

    if (success) {
      setSelectedFiles([]);
    }

    await refreshFiles();
  };

  const handleViewFile = async (file: StorageFile) => {
    const key = formatObjectKey(file);
    const url = await fetchDownloadUrl(token, app.id, key);
    console.debug(url);
    window.open(url, '_blank');
  };

  const handleDeleteFile = async (file: StorageFile) => {
    const key = formatObjectKey(file);

    if (!confirm(`Are you sure you want to permanently delete\n"${key}"?`)) {
      return;
    }

    await deleteStorageFile(token, app.id, key);
    await refreshFiles();
  };

  return (
    <div className={cn('flex-1 flex flex-col', className)}>
      <div className="flex justify-between flex-row items-center border-b ">
        <div className="px-2 pt-1 pb-1">
          <SectionHeading>Storage</SectionHeading>
          <div className="mt-1 flex items-center gap-1 text-xs font-mono">
            {breadcrumbs.map((b, i, arr) => {
              return (
                <span className="inline-flex items-center gap-1" key={i}>
                  {i > 0 && (
                    <ChevronRightIcon className="h-3 w-3 text-gray-400" />
                  )}
                  <button
                    className={cn(
                      i === arr.length - 1
                        ? 'font-semibold text-gray-700'
                        : 'font-medium text-gray-600 underline'
                    )}
                    onClick={() => {
                      const prefix = breadcrumbs.slice(1, i + 1).join('/');

                      return setSubdirectoryPrefix(prefix);
                    }}
                  >
                    {b}
                  </button>
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex gap-2 px-2 py-1 justify-between">
          <input
            type="file"
            className="flex h-9 rounded-md border border-zinc-200 bg-transparent px-1 py-1 text-sm shadow-sm transition-colors file:text-sm placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(e: React.ChangeEvent<any>) =>
              setSelectedFiles(e.target.files)
            }
          />
          <Button
            variant="primary"
            disabled={selectedFiles.length === 0}
            size="mini"
            onClick={handleUploadFile}
          >
            Upload file
          </Button>
        </div>
      </div>
      <table className="z-0 w-full flex-1 text-left font-mono text-xs text-gray-500">
        <thead className="sticky top-0 z-20 bg-white text-gray-700 shadow">
          <tr>
            <th className="px-2 py-2" style={{ width: '48px' }}>
              <Checkbox checked={false} onChange={(checked) => {}} />
            </th>
            <th
              className={cn(
                'w-full z-10 cursor-pointer select-none whitespace-nowrap px-4 py-1'
              )}
            >
              Name
            </th>
            <th
              className={cn(
                'z-10 cursor-pointer select-none whitespace-nowrap px-4 py-1'
              )}
            >
              Size
            </th>
            <th
              className={cn(
                'z-10 cursor-pointer select-none whitespace-nowrap px-4 py-1'
              )}
            >
              Last modified
            </th>
            <th
              className={cn(
                'z-10 cursor-pointer select-none whitespace-nowrap px-4 py-1'
              )}
            ></th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {directories.map((directory) => {
            return (
              <tr key={directory.name} className="group border-b bg-white">
                <td
                  className="px-2 py-2 flex gap-2 items-center"
                  style={{ width: '48px' }}
                >
                  <Checkbox checked={false} onChange={(checked) => {}} />
                </td>
                <td className="w-full relative px-4 py-1">
                  <button
                    className="font-semibold"
                    onClick={() =>
                      setSubdirectoryPrefix((current) =>
                        [current, directory.name]
                          .filter((str) => !!str)
                          .join('/')
                      )
                    }
                  >
                    {directory.name.concat('/')}
                  </button>
                </td>
                <td className="relative px-4 py-1">
                  {directory.size / 1000}KB
                </td>
                <td className="relative px-4 py-1">
                  {format(new Date(directory.lastModified), 'MMM dd, h:mma')}
                </td>
                <td className="relative px-4 py-1"></td>
              </tr>
            );
          })}
          {files.map((file) => (
            <tr key={file.key} className="group border-b bg-white">
              <td
                className="px-2 py-2 flex gap-2 items-center"
                style={{ width: '48px' }}
              >
                <Checkbox checked={false} onChange={(checked) => {}} />
              </td>
              <td className="w-full relative px-4 py-1">{file.name}</td>
              <td className="relative px-4 py-1">{file.size / 1000}KB</td>
              <td className="relative whitespace-nowrap px-4 py-1">
                {format(new Date(file.lastModified), 'MMM dd, h:mma')}
              </td>
              <td className="relative px-4 py-1" style={{}}>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="mini"
                    onClick={() => handleViewFile(file)}
                  >
                    View
                  </Button>
                  <Button
                    variant="destructive"
                    size="mini"
                    onClick={() => handleDeleteFile(file)}
                  >
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          <tr className="h-full"></tr>
        </tbody>
      </table>
    </div>
  );
}
