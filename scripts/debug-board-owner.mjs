import '../src/shared/loadEnv.js';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { WalletManager } from '../src/wallet/WalletManager.js';

const network = process.env.SUI_NETWORK || 'testnet';
const boardId = process.env.BOUNTY_BOARD_ID;

if (!boardId) {
  console.error('BOUNTY_BOARD_ID is missing');
  process.exit(1);
}

const client = new SuiClient({ url: getFullnodeUrl(network) });
const obj = await client.getObject({ id: boardId, options: { showContent: true } });
const fields = obj.data?.content?.fields;

const wallet = new WalletManager();
await wallet.initialize({
  keySource: (process.env.WALLET_KEY_SOURCE === 'generate' ? 'generate' : 'env'),
  network,
  bountyPackageId: process.env.BOUNTY_PACKAGE_ID || '0x',
  bountyBoardId: boardId,
});

console.log(
  JSON.stringify(
    {
      network,
      boardId,
      boardOwner: fields?.owner,
      treasury: fields?.treasury?.fields?.value,
      walletAddress: wallet.getAddress(),
    },
    null,
    2,
  ),
);
