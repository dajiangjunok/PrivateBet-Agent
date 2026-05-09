/**
 * Deploy MockUSDC (a minimal mintable ERC-20 with 6 decimals) to Sepolia.
 *
 * Usage: npx tsx scripts/deploy-sepolia.ts
 *
 * Reads SEPOLIA_RPC_URL and PRIVATE_KEY from the environment (or .env if loaded
 * by the caller). Prints the deployed address as a `MOCK_USDC_ADDR=` line that
 * can be appended to .env.
 */

import { JsonRpcProvider, Wallet, ContractFactory, formatEther, parseUnits } from 'ethers';
import solc from 'solc';

const PRIVATE_KEY =
  process.env['PRIVATE_KEY'] ??
  '0xb61adb88df4815744b0f25ade675e2b0f78efbf87675c2b69506d20ef6ca3487';
const RPC_URL =
  process.env['SEPOLIA_RPC_URL'] ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const USDC_DECIMALS = 6;

const SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockUSDC {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
        owner = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
`;

interface SolcOutput {
  errors?: Array<{ severity: string; formattedMessage: string }>;
  contracts: {
    [file: string]: {
      [contract: string]: {
        abi: unknown[];
        evm: { bytecode: { object: string } };
      };
    };
  };
}

function compile(): { abi: unknown[]; bytecode: string } {
  const input = {
    language: 'Solidity',
    sources: { 'MockUSDC.sol': { content: SOURCE } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const output: SolcOutput = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (output.errors ?? []).filter((e) => e.severity === 'error');
  if (fatal.length > 0) {
    throw new Error(`solc errors:\n${fatal.map((e) => e.formattedMessage).join('\n')}`);
  }
  const compiled = output.contracts['MockUSDC.sol']?.['MockUSDC'];
  if (!compiled) throw new Error('compiled contract missing from solc output');
  return { abi: compiled.abi, bytecode: '0x' + compiled.evm.bytecode.object };
}

async function main(): Promise<void> {
  const { abi, bytecode } = compile();
  console.log('Compiled MockUSDC:', bytecode.length / 2 - 1, 'bytes');

  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(PRIVATE_KEY, provider);
  console.log('Deployer:', wallet.address);
  console.log('Balance:', formatEther(await provider.getBalance(wallet.address)), 'ETH');

  const factory = new ContractFactory(abi, bytecode, wallet);
  console.log('Deploying MockUSDC...');
  const contract = await factory.deploy('Mock USDC', 'USDC', USDC_DECIMALS);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  console.log('✅ MockUSDC deployed to:', address);
  if (deployTx) console.log('   tx:', deployTx.hash);

  console.log('Minting 1,000,000 USDC to deployer...');
  const mintAmount = parseUnits('1000000', USDC_DECIMALS);
  const mintTx = await (contract as any).mint(wallet.address, mintAmount);
  console.log('   tx:', mintTx.hash);
  await mintTx.wait();
  console.log('✅ Minted');

  const decimals = await (contract as any).decimals();
  const balance = await (contract as any).balanceOf(wallet.address);
  console.log('decimals:', decimals.toString());
  console.log('balance:', balance.toString());

  console.log('\n📋 Add to .env:');
  console.log(`MOCK_USDC_ADDR=${address}`);
  console.log('CONFIDENTIAL_ERC20_ADDR=  # ZAMA wrapper still pending');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
