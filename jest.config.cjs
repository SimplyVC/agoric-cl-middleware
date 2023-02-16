module.exports = {
    transform: {
      "^.+\\.[t|j|cj]sx?$": "babel-jest",
      "./jest.setup.cjs": "babel-jest"
    },
    setupFiles: ['./jest.setup.cjs'],
    transformIgnorePatterns: [
      "node_modules\/(^.+\\.[t|j]sx?$)",
      "node_modules\/@endo\/.*"
    ],
};
