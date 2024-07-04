import fs from 'fs/promises';
import type { Plugin, PluginOption, ResolvedConfig } from 'vite';
import { getOutput, getPublic } from './utils';
import { writeConfig } from './config';
import { buildEndpoints } from './build';
import { buildPrerenderConfigs, execPrerender } from './prerender';
import path from 'path';
import type { ViteVercelPrerenderRoute } from './types';
import { copyDir } from './helpers';

export * from './types';

function vercelPluginCleanup(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    apply: 'build',
    name: 'vite-plugin-vercel:cleanup',
    enforce: 'pre',

    configResolved(config) {
      resolvedConfig = config;
    },
    writeBundle: {
      order: 'pre',
      sequential: true,
      async handler() {
        if (!resolvedConfig.build?.ssr) {
          // step 1:	Clean .vercel/ouput dir
          await cleanOutputDirectory(resolvedConfig);
        }
      },
    },
  };
}

function vercelPlugin(): Plugin {
  let resolvedConfig: ResolvedConfig;
  let vikeFound = false;

  return {
    apply: 'build',
    name: 'vite-plugin-vercel',
    enforce: 'post',

    configResolved(config) {
      resolvedConfig = config;
      vikeFound = resolvedConfig.plugins.some((p) =>
        p.name.match('^vite-plugin-ssr:|^vike:'),
      );

      if (
        typeof resolvedConfig.vercel?.distContainsOnlyStatic === 'undefined'
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (resolvedConfig as any).vercel ??= {};
        resolvedConfig.vercel!.distContainsOnlyStatic = !vikeFound;
      }
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      async handler() {
        if (!resolvedConfig.build?.ssr) {
          // special case: Vike triggers a second build with --ssr
          // TODO: find a way to fix that in a more generic way
          if (vikeFound) {
            return;
          }
        }

        // step 2:	Execute prerender
        const overrides = await execPrerender(resolvedConfig);

        // step 3:	Compute overrides for static HTML files
        const userOverrides = await computeStaticHtmlOverrides(resolvedConfig);

        // step 4:	Compile serverless functions to ".vercel/output/functions"
        const { rewrites, isr, headers } = await buildEndpoints(resolvedConfig);

        // step 5:	Generate prerender config files
        rewrites.push(...(await buildPrerenderConfigs(resolvedConfig, isr)));

        // step 6:	Generate config file
        await writeConfig(
          resolvedConfig,
          rewrites,
          {
            ...userOverrides,
            ...overrides,
          },
          headers,
        );

        // step 7: Copy dist folder to static
        await copyDistToStatic(resolvedConfig);
      },
    },
  };
}

async function cleanOutputDirectory(resolvedConfig: ResolvedConfig) {
  await fs.rm(getOutput(resolvedConfig), {
    recursive: true,
    force: true,
  });

  await fs.mkdir(getOutput(resolvedConfig), { recursive: true });
}

async function copyDistToStatic(resolvedConfig: ResolvedConfig) {
  if (resolvedConfig.vercel?.distContainsOnlyStatic) {
    await copyDir(
      resolvedConfig.build.outDir,
      getOutput(resolvedConfig, 'static'),
    );
  }
}

async function computeStaticHtmlOverrides(
  resolvedConfig: ResolvedConfig,
): Promise<NonNullable<ViteVercelPrerenderRoute>> {
  const staticAbsolutePath = getOutput(resolvedConfig, 'static');
  const files = await getStaticHtmlFiles(staticAbsolutePath);

  // public files copied by vite by default https://vitejs.dev/guide/assets.html#the-public-directory
  const publicDir = getPublic(resolvedConfig);
  const publicFiles = await getStaticHtmlFiles(publicDir);
  files.push(
    ...publicFiles.map((f) => f.replace(publicDir, staticAbsolutePath)),
  );

  return files.reduce((acc, curr) => {
    const relPath = path.relative(staticAbsolutePath, curr);
    const parsed = path.parse(relPath);
    const pathJoined = path.join(parsed.dir, parsed.name);
    acc[relPath] = {
      path: pathJoined,
    };
    return acc;
  }, {} as NonNullable<ViteVercelPrerenderRoute>);
}

async function getStaticHtmlFiles(src: string) {
  try {
    await fs.stat(src);
  } catch (e) {
    return [];
  }

  const entries = await fs.readdir(src, { withFileTypes: true });
  const htmlFiles: string[] = [];

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);

    entry.isDirectory()
      ? htmlFiles.push(...(await getStaticHtmlFiles(srcPath)))
      : srcPath.endsWith('.html')
        ? htmlFiles.push(srcPath)
        : undefined;
  }

  return htmlFiles;
}

/**
 * Auto import `@vite-plugin-vercel/vike` if it is part of dependencies.
 * Ensures that `vike/plugin` is also present to ensure predictable behavior
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tryImportVpvv(options: any) {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    await import('vike/plugin');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const vpvv = await import('@vite-plugin-vercel/vike');
    return vpvv.default(options);
  } catch (e) {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      await import('vite-plugin-ssr/plugin');
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const vpvv = await import('@vite-plugin-vercel/vike');
      return vpvv.default(options);
    } catch (e) {
      return null;
    }
  }
}

// `smart` param only exist to circumvent a pnpm issue in dev
// See https://github.com/pnpm/pnpm/issues/3697#issuecomment-1708687974
// FIXME: Could be fixed by:
//  - shared-workspace-lockfile=false in .npmrc. See https://pnpm.io/npmrc#shared-workspace-lockfile
//  - Moving demo test in dedicated repo, with each a correct package.json
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function allPlugins(options: any = {}): PluginOption[] {
  const { smart, ...rest } = options;
  return [
    vercelPluginCleanup(),
    vercelPlugin(),
    smart !== false ? tryImportVpvv(rest) : null,
  ];
}
