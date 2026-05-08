module.exports = function (api) {
  api.cache(true);
  let expoPreset = "babel-preset-expo";
  try {
    require.resolve(expoPreset);
  } catch {
    expoPreset = require.resolve("expo/node_modules/babel-preset-expo");
  }
  return {
    presets: [expoPreset]
  };
};
