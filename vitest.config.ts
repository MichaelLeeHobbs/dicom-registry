import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
        exclude: ['**/node_modules/**'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // Barrels have no logic; generated data modules are object literals
            // whose correctness is asserted by the differential suite, not by
            // line coverage — including them would only dilute the signal.
            exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/generated/**'],
            thresholds: {
                statements: 95,
                branches: 90,
                functions: 95,
                lines: 95,
            },
        },
    },
});
