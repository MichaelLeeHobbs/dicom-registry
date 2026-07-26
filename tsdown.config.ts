import { defineConfig } from 'tsdown';

export default defineConfig({
    // One entry per dataset boundary, so a consumer that only wants the tag
    // codec never pulls the private-tag table. Entries are added as their
    // dataset lands. `private` has its own entry and is NOT in the barrel:
    // it is the largest table here and most consumers never touch a private tag.
    entry: {
        index: 'src/index.ts',
        tag: 'src/tag.ts',
        uid: 'src/uid.ts',
        vm: 'src/vm.ts',
        vr: 'src/vr.ts',
        attributes: 'src/attributes.ts',
        deident: 'src/deident.ts',
        private: 'src/private.ts',
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
