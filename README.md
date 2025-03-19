# Monad NFT Minting Tool

A modular command-line tool for minting NFTs on the Monad blockchain. Simplifies interaction with NFT contracts by automatically detecting the correct minting function and parameters.

## Features

-   **Multiple Minting Modes**:
          Instant Minting: Executes minting operations immediately.
          Scheduled Minting: Automatically starts minting at a specified time.
         Monitoring Mode: Continuously monitors contract status, automatically detects and executes minting.
-   **Smart Contract Integration**:
          Automatically detects the correct minting function and parameters.
          Supports both fourParams and twoParams minting methods.
          Automatic retry mechanism to improve minting success rate.
-   **Automatic Price Detection**: Automatically retrieves the minting price from the contract.
-   **Multi-Wallet Support**: Supports configuring multiple wallets for simultaneous minting.
-   **Dynamic Gas Optimization**:
         Real-time retrieval of network Gas prices.
         Intelligent adjustment of Gas parameters to improve minting success rate.
          Three levels of priority fee presets: Normal, Fast, and Fastest.
-   **Series Details**: Displays series name and supply information.
-   **Magic Eden Link Support**: Directly paste Magic Eden minting links to extract contract addresses.

## Installation Instructions

1.  Clone the repository:

```bash
git clone https://github.com/PiyushBaria/monad_magic
cd monad_magic
```

2.  Install dependencies:

```bash
npm install
```

3.  Configure wallets:

    Add your private keys to the `.env` file. Supports configuring multiple wallets:

    ```
    NETWORK=monad-testnet
    MAX_CONCURRENT_MINTS=10
    DEFAULT_GAS_LIMIT_MIN=180000
    DEFAULT_GAS_LIMIT_MAX=280000

    # Configure multiple wallets
    PRIVATEKEY_1=0xYourPrivateKey1
    PRIVATEKEY_2=0xYourPrivateKey2
    PRIVATEKEY_3=0xYourPrivateKey3
    ```

    ⚠️ **Important Notes**:

          Never share your `.env` file or reveal your private keys.
          The format for multiple wallet private keys is PRIVATEKEY_1, PRIVATEKEY_2, etc.
      Ensure each private key starts with 0x.

## Usage

Start the minting tool:

```bash
# Set environment variables
npm run setup # This will create the .env file from env.template

# Start
npm start
```

### Minting Mode Selection

1.  **Instant Minting Mode**
          Executes minting operations immediately.
          Suitable for minting events that have already started.

2.  **Scheduled Minting Mode**
          Sets a specific time to automatically start minting.
          The program will wait until the specified time.
          Suitable for minting events with known start times.

3.  **Monitoring Mode**
          Continuously monitors contract status.
          Automatically detects when minting has started.
          Executes immediately when minting begins.
          Suitable for minting events with uncertain start times.
    -   Monitoring interval can be set (default 3 seconds).

### Gas Parameter Explanation

1.  **Gas Limit**
          Recommended setting: 110000.
          Cannot be lower than 100000.

2.  **Gas Price**
          Dynamically retrieves the current network Base Fee.
          Recommended setting: 2 times the current Base Fee.
          The program will display real-time recommended values.

3.  **Priority Fee**
          Calculated as a percentage of the current Base Fee.
          Default: 10% of the Base Fee.
          Customizable percentage (1-100%).
          Recommended settings:
        -      Idle network: 10-20%.
        -      Busy network: 20-40%.
        -      Congested network: Above 40%.
          Higher percentages increase transaction packing priority.

### Minting Method Selection

1.  **Automatic Mode (Recommended)**
          First attempts the fourParams method.
          Automatically switches to the twoParams method if the first attempt fails.
          Avoids gas wastage.

2.  **Specified Mode**
          fourParams: Directly uses the fourParams method.
          twoParams: Directly uses the twoParams method.
          Suitable for cases where the correct minting method is known.

### Usage Example

```
─────────────────────────────────
        MONAD NFT Minting Tool
        Mint NFTs on the Monad Chain
─────────────────────────────────

? Minting Mode: Monitoring Mode
? NFT Contract Address or Magic Eden Link: https://magiceden.io/mint-terminal/monad-testnet/0x000000000000000
> Using contract address: 0x00000000000000
> Series: MyNFTCollection (MNFT)
> Start monitoring minting status...
> Monitoring interval: 3 seconds
+ Minting has started!
- Minting price: 0.0001 MON
- End time: 2024-03-15 12:00:00
> Start minting with wallet 1...
+ Minting transaction sent! [0x0000...000]
  https://testnet.monadexplorer.com/tx/000000000
+ Transaction confirmed in block [6290517]
+ Minting process completed!
```

## Error Handling

      If minting fails, the program automatically tries different minting methods.
      Displays detailed error messages and status.
      Automatic retry mechanism to improve success rate.
      Intelligent detection of contract status and conditions.

## Project Structure

```
|— api/
|    |— core/ # Core components
|    |— services/ # API services
|    |— utils/ # Utility tools
|— config/ # Configuration files
|— main.js # Main program entry point
```

## Supported Networks

Currently supports the Monad testnet.

## Contribution

Contributions are welcome! Feel free to submit issues or pull requests.

## License

This project is licensed under the MIT License.
