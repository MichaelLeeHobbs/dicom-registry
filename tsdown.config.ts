import { defineConfig } from 'tsdown';

export default defineConfig({
    // One entry per dataset boundary, so a consumer that only wants the tag
    // codec never pulls the private-tag table. Entries are added as their
    // dataset lands — attributes, uid, private and deident are still to come.
    entry: {
        index: 'src/index.ts',
        tag: 'src/tag.ts',
    },
    tsconfig: 'tsconfig.build.json',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: false,
    platform: 'neutral',
    target: 'es2022',
});
