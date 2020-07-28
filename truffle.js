require('ts-node/register/transpile-only')

const HDWalletProvider = require('@truffle/hdwallet-provider')
const infuraKey = 'c3422181d0594697a38defe7706a1e5b'

const fs = require('fs')
const mnemonic = () => fs.readFileSync('.secret').toString().trim()

module.exports = {

  networks: {
    development: {
      host: '127.0.0.1', // Localhost (default: none)
      port: 8545, // Standard Ethereum port (default: none)
      network_id: '*' // Any network (default: none)
    },

    ropsten: {
      provider: () => new HDWalletProvider(mnemonic(), 'https://ropsten.infura.io/v3/' + infuraKey),
      network_id: 3,
      skipDryRun: true // Skip dry run before migrations? (default: false for public nets )
    },
    rinkeby: {
      provider: () => new HDWalletProvider(mnemonic(), 'https://rinkeby.infura.io/v3/' + infuraKey),
      network_id: 4, // Ropsten's id
      skipDryRun: true // Skip dry run before migrations? (default: false for public nets )
    },
    kovan: {
      provider: () => new HDWalletProvider(mnemonic(), 'https://kovan.infura.io/v3/' + infuraKey),
      network_id: 42,
      skipDryRun: true // Skip dry run before migrations? (default: false for public nets )
    }
  },

  // Set default mocha options here, use special reporters etc.
  mocha: {
    slow: 1000,
    timeout: 10000
  },

  // Configure your compilers
  compilers: {
    solc: {
      version: '0.6.10', // Fetch exact version from solc-bin (default: truffle's version)
      settings: { // See the solidity docs for advice about optimization and evmVersion
        optimizer: {
          enabled: true,
          runs: 200
        },
        evmVersion: 'istanbul'
      }
    }
  }
}
