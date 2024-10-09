import type { OfflineSigner } from "@cosmjs/proto-signing";
import {
  GasPrice,
  SigningStargateClient,
  type SigningStargateClientOptions,
  StargateClient,
} from "@cosmjs/stargate";
import {
  AssetValue,
  Chain,
  ChainId,
  type CosmosChain,
  FeeOption,
  RPCUrl,
  defaultRequestHeaders,
} from "@swapkit/helpers";

import { type TransferTxParams, bech32ToBase64 } from "./thorchainUtils";
import type { CosmosMaxSendableAmountParams } from "./types";

export const USK_KUJIRA_FACTORY_DENOM =
  "FACTORY/KUJIRA1QK00H5ATUTPSV900X202PXX42NPJR9THG58DNQPA72F2P7M2LUASE444A7/UUSK";

export const YUM_KUJIRA_FACTORY_DENOM =
  "FACTORY/KUJIRA1YGFXN0ER40KLCNCK8THLTUPRDXLCK6WVNPKF2K/UYUM";

export const DEFAULT_COSMOS_FEE_MAINNET = {
  amount: [{ denom: "uatom", amount: "500" }],
  gas: "200000",
};

export const DEFAULT_KUJI_FEE_MAINNET = {
  amount: [{ denom: "ukuji", amount: "1000" }],
  gas: "200000",
};

export const getDefaultChainFee = (chain: CosmosChain) => {
  switch (chain) {
    case Chain.Maya:
      return { amount: [], gas: "10000000000" };
    case Chain.THORChain:
      return { amount: [], gas: "500000000" };
    case Chain.Kujira:
      return DEFAULT_KUJI_FEE_MAINNET;
    default:
      return DEFAULT_COSMOS_FEE_MAINNET;
  }
};

export const getDenom = (symbol: string, isThorchain = false) => {
  if (isThorchain) {
    return symbol.toLowerCase();
  }

  switch (symbol) {
    case "uUSK":
    case "USK":
      return USK_KUJIRA_FACTORY_DENOM;
    case "uYUM":
    case "YUM":
      return YUM_KUJIRA_FACTORY_DENOM;
    case "uKUJI":
    case "KUJI":
      return "ukuji";
    case "ATOM":
    case "uATOM":
      return "uatom";
    default:
      return symbol;
  }
};

export const getDenomWithChain = ({ symbol, chain }: AssetValue) => {
  if (chain === Chain.Maya) {
    return (symbol.toUpperCase() !== "CACAO" ? symbol : `${Chain.Maya}.${symbol}`).toUpperCase();
  }
  if (chain === Chain.THORChain) {
    return (
      symbol.toUpperCase() !== "RUNE" ? symbol : `${Chain.THORChain}.${symbol}`
    ).toUpperCase();
  }
  return getDenom(symbol, false);
};

// TODO: figure out some better way to initialize from base value
export const getAssetFromDenom = (denom: string, amount: string) => {
  switch (denom) {
    case "rune":
      return AssetValue.from({ chain: Chain.THORChain, value: Number.parseInt(amount) / 1e8 });
    case "uatom":
    case "atom":
      return AssetValue.from({ chain: Chain.Cosmos, value: Number.parseInt(amount) / 1e6 });
    case "cacao":
      return AssetValue.from({ chain: Chain.Maya, value: Number.parseInt(amount) / 1e10 });
    case "maya":
      return AssetValue.from({
        asset: `${Chain.Maya}.${Chain.Maya}`,
        value: Number.parseInt(amount) / 1e4,
      });
    case "ukuji":
    case "kuji":
      return AssetValue.from({ chain: Chain.Kujira, value: Number.parseInt(amount) / 1e6 });
    case USK_KUJIRA_FACTORY_DENOM:
      // USK on Kujira
      return AssetValue.from({
        asset: `${Chain.Kujira}.USK`,
        value: Number.parseInt(amount) / 1e6,
      });

    default:
      return AssetValue.from({ asset: denom, value: Number.parseInt(amount) / 1e8 });
  }
};

export const createStargateClient = (url: string) => {
  return StargateClient.connect({ url, headers: defaultRequestHeaders });
};

export const createSigningStargateClient = (
  url: string,
  signer: any,
  optionsOrBaseGas: string | SigningStargateClientOptions = {},
) => {
  const gasPrice = typeof optionsOrBaseGas === "string" ? optionsOrBaseGas : "0.0003uatom";
  const options = typeof optionsOrBaseGas === "string" ? {} : optionsOrBaseGas;

  return SigningStargateClient.connectWithSigner({ url, headers: defaultRequestHeaders }, signer, {
    gasPrice: GasPrice.fromString(gasPrice),
    ...options,
  });
};

export const createOfflineStargateClient = (
  wallet: OfflineSigner,
  registry?: SigningStargateClientOptions,
) => {
  return SigningStargateClient.offline(wallet, registry);
};

export const getRPC = (chainId: ChainId, stagenet?: boolean) => {
  switch (chainId) {
    case ChainId.Cosmos:
      return RPCUrl.Cosmos;
    case ChainId.Kujira:
      return RPCUrl.Kujira;

    case ChainId.THORChain:
    case "thorchain-mainnet-v1" as ChainId:
      return stagenet ? RPCUrl.THORChainStagenet : RPCUrl.THORChain;
    case ChainId.Maya:
      return stagenet ? RPCUrl.MayaStagenet : RPCUrl.Maya;

    default:
      return RPCUrl.Cosmos;
  }
};

export const estimateMaxSendableAmount = async ({
  from,
  toolbox,
  asset,
  feeOptionKey = FeeOption.Fast,
}: CosmosMaxSendableAmountParams): Promise<AssetValue> => {
  const assetEntity =
    typeof asset === "string" ? await AssetValue.from({ asyncTokenLookup: true, asset }) : asset;
  const balances = await toolbox.getBalance(from);
  const balance = balances.find(({ symbol, chain }) =>
    asset ? symbol === assetEntity?.symbol : symbol === AssetValue.from({ chain }).symbol,
  );

  const fees = await toolbox.getFees();

  if (!balance) {
    return AssetValue.from({ chain: assetEntity?.chain || balances[0]?.chain || Chain.Cosmos });
  }

  return balance.sub(fees[feeOptionKey]);
};

export const buildTransferTx = async ({
  fromAddress,
  toAddress,
  assetValue,
  memo = "",
  isStagenet = false,
}: TransferTxParams) => {
  const { chain, chainId } = assetValue;

  const url = getRPC(chainId, isStagenet);

  const client = await createStargateClient(url);

  const accountOnChain = await client.getAccount(fromAddress);

  if (!accountOnChain) {
    throw new Error("Account does not exist");
  }

  const base64FromAddress = bech32ToBase64(fromAddress);
  const base64ToAddress = bech32ToBase64(toAddress);

  const fee = getDefaultChainFee(chain as CosmosChain);

  // TODO estimate gas amount and use defaults as fallback
  // check transfer method in kuji or gaia toolbox

  const msgSend = {
    fromAddress: base64FromAddress,
    toAddress: base64ToAddress,
    amount: [
      {
        amount: assetValue.getBaseValue("string"),
        denom: getDenomWithChain(assetValue),
      },
    ],
  };

  return {
    memo,
    accountNumber: accountOnChain.accountNumber,
    sequence: accountOnChain.sequence,
    chainId,
    msgs: [{ typeUrl: "/types.MsgSend", value: msgSend }],
    fee,
  };
};
