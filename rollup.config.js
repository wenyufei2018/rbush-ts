const typescript = require('rollup-plugin-typescript2');

module.exports = {
  input: 'index.ts',
  output: [
    {
      file: 'dist/rbush.esm.js',
      format: 'esm',
      sourcemap: true,
    },
    {
      file: 'dist/rbush.cjs.js',
      format: 'cjs',
      sourcemap: true,
    },
  ],
  plugins: [typescript()],
};
