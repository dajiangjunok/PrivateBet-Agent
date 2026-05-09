export type NetworkMode = 'testnet' | 'mainnet';

export function getNetworkMode(): NetworkMode {
  return process.env['NETWORK_MODE'] === 'mainnet' ? 'mainnet' : 'testnet';
}
