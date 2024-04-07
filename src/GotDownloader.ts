import * as fs from 'fs-extra';
import got, { HTTPError, Progress as GotProgress, Options as GotOptions } from 'got';
import * as path from 'path';
import * as ProgressBar from 'progress';

import { Downloader } from './Downloader';

const PROGRESS_BAR_DELAY_IN_SECONDS = 30;

/**
 * See [`got#options`](https://github.com/sindresorhus/got#options) for possible keys/values.
 */
export type GotDownloaderOptions = (GotOptions & { isStream?: true }) & {
  /**
   * if defined, triggers every time `got`'s `downloadProgress` event callback is triggered.
   */
  getProgressCallback?: (progress: GotProgress) => Promise<void>;
  /**
   * if `true`, disables the console progress bar (setting the `ELECTRON_GET_NO_PROGRESS`
   * environment variable to a non-empty value also does this).
   */
  quiet?: boolean;
};

export class GotDownloader implements Downloader<GotDownloaderOptions> {
  async download(
    url: string,
    targetFilePath: string,
    options?: GotDownloaderOptions,
  ): Promise<void> {
    if (!options) {
      options = {};
    }
    const { quiet, getProgressCallback, ...gotOptions } = options;
    let downloadCompleted = false;
    let bar: ProgressBar | undefined;
    let progressPercent: number;
    let timeout: NodeJS.Timeout | undefined = undefined;
    await fs.mkdirp(path.dirname(targetFilePath));
    const writeStream = fs.createWriteStream(targetFilePath);

    if (!quiet || !process.env.ELECTRON_GET_NO_PROGRESS) {
      const start = new Date();
      timeout = setTimeout(() => {
        if (!downloadCompleted) {
          bar = new ProgressBar(
            `Downloading ${path.basename(url)}: [:bar] :percent ETA: :eta seconds `,
            {
              curr: progressPercent,
              total: 100,
            },
          );
          // https://github.com/visionmedia/node-progress/issues/159
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (bar as any).start = start;
        }
      }, PROGRESS_BAR_DELAY_IN_SECONDS * 1000);
    }
    await new Promise<void>((resolve, reject) => {
      const downloadStream = got.stream(url, gotOptions);
      downloadStream.on('downloadProgress', async progress => {
        const calculatedPercent = Math.round((progress.transferred / progress.total) * 100);
        if (bar) {
          bar.update(calculatedPercent);
        }
        if (getProgressCallback) {
          await getProgressCallback(progress);
        }
      });
      downloadStream.on('error', error => {
        if (error instanceof HTTPError && error.response.statusCode === 404) {
          error.message += ` for ${error.response.url}`;
        }
        if (writeStream.destroy) {
          writeStream.destroy(error);
        }

        reject(error);
      });
      writeStream.on('error', error => reject(error));
      writeStream.on('close', () => resolve());

      downloadStream.pipe(writeStream);
    });

    downloadCompleted = true;
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
