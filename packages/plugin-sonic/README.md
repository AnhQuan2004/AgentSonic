# @elizaos/plugin-sonic

A powerful plugin for Eliza OS that provides integration with Aptos blockchain and Sonic protocol functionalities.

## Features

- **Bounty Management**
  - Create and manage bounties
  - Participate in bounties
  - Distribute rewards
  - View bounty details and status

- **Data Analysis**
  - Process and analyze social media posts
  - Generate insights from community data
  - Label and categorize content
  - Track engagement metrics

- **IPFS Integration**
  - Store and retrieve data from Pinata
  - Manage content hashes
  - Handle file uploads and downloads

## Usage

### Initialize Plugin

```typescript
import { aptosPlugin } from '@elizaos/plugin-sonic';

// Register plugin with Eliza
eliza.registerPlugin(aptosPlugin);
```

### Create Bounty

```typescript
const bountyData = {
  bountyId: "unique_id",
  dataRefer: "ipfs_hash",
  stakingAmount: 1000,
  minimumOfUser: 5,
  expireTime: 86400 // 24 hours
};

await createBounty(
  bountyData.bountyId,
  bountyData.dataRefer,
  bountyData.stakingAmount,
  bountyData.minimumOfUser,
  bountyData.expireTime
);
```


### Data Analysis

```typescript
const analysis = await giveInsightData.handler(runtime, {
  content: {
    text: "Analyze recent posts"
  }
}, state);
```

## API Reference

### Actions

- `createBounty`: Create new bounties
- `checkVerify`: Verify bounty submissions
- `giveInsightData`: Generate data insights

### Services

- `sonicServices`: Core blockchain interactions
- `bountyServices`: Bounty management functions
- `pinataServices`: IPFS storage operations

## Development

1. Clone the repository:

```bash
git clone <repository-url>
```

2. Install dependencies:

```bash
pnpm install
```

3. Run tests:

```bash
pnpm run test
```

4. Development mode:

```bash
pnpm run dev
```

## Dependencies

- @aptos-labs/ts-sdk: ^1.26.0
- @elizaos/core: workspace:*
- ethers: ^6.11.1
- bignumber.js: 9.1.2
- node-cache: 5.1.2

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT

## Support

For support, please open an issue in the repository or contact the maintainers.