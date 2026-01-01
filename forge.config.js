const path = require('path');

module.exports = {
    packagerConfig: {
        name: 'AutoPing',
        executableName: 'AutoPing',
        asar: true,
        ignore: [
            /^\/server\/node_modules/,
            /^\/server\/.*\.db$/,
            /^\/client\/node_modules/,
            /^\/client\/src/,
            /^\/ps2exe/,
            /^\/\.git/,
            /^\/dist$/,
            /\.ps1$/
        ]
    },
    rebuildConfig: {},
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'AutoPing',
                setupExe: 'AutoPing-Setup.exe'
            }
        },
        {
            name: '@electron-forge/maker-zip',
            platforms: ['win32']
        }
    ]
};
