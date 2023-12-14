import { AbiCoder, WebSocketProvider } from "ethers";

import axios from "axios";
import WebSocket from "ws";
import "dotenv/config";

const etherScanApiKey = process.env.ETHERSCAN_API_KEY;

var init = async function () {
  const wsUrl = process.env.QUICK_NODE_WS_URL;

  const configWebSocket = () => {
    const ws = new WebSocket(wsUrl);

    ws.onerror = (e) => {
      console.log("\x1b[31m", "WS error");
      setTimeout(init, 3000);
    };

    ws.onclose = (e) => {
      console.log("\x1b[31m", "WS closed");
      ws.terminate();
      setTimeout(init, 3000);
    };

    return ws;
  };

  const provider = new WebSocketProvider(configWebSocket);

  const uniswapV2Factory = "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f";
  provider.on(
    {
      address: uniswapV2Factory,
    },
    async (log) => {
      await onPairCreated(log, "v2");
    }
  );

  const uniswapV3Factory = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

  provider.on(
    {
      address: uniswapV3Factory,
    },
    async (log) => {
      console.log("V3 Pair created");
      await onPairCreated(log, "v3");
    }
  );
};

init();

function getInfoFromLogV3(log) {
  const txHash = log.transactionHash;

  const newTokenHex = log.topics
    .slice(1, 3)
    .filter(
      (t) =>
        t !==
          "0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" &&
        t !==
          "0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
    )[0];
  const newTokenAddress = AbiCoder.defaultAbiCoder().decode(
    ["address"],
    newTokenHex
  )[0];
  const pairAddress = AbiCoder.defaultAbiCoder().decode(
    ["uint256", "address"],
    log.data
  )[1];

  return {
    txHash: txHash,
    tokenAddress: newTokenAddress,
    pairAddress: pairAddress,
  };
}

function getInfoFrom(log) {
  const txHash = log.transactionHash;
  const newTokenHex = log.topics.filter(
    (t) =>
      t !==
        "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9" &&
      t !== "0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
  )[0];
  const newTokenAddress = AbiCoder.defaultAbiCoder().decode(
    ["address"],
    newTokenHex
  )[0];
  const pairAddress = AbiCoder.defaultAbiCoder().decode(
    ["address", "uint256"],
    log.data
  )[0];

  return {
    txHash: txHash,
    tokenAddress: newTokenAddress,
    pairAddress: pairAddress,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function onPairCreated(log, uniswapVersion) {
  let info = {};

  if (uniswapVersion == "v2") {
    info = getInfoFrom(log);
  } else {
    info = getInfoFromLogV3(log);
  }

  var datetime = new Date().toLocaleTimeString();
  console.log(datetime, ": ", info);

  sleep(3000);

  const honeypotInfo = await getHoneypot(info.tokenAddress);

  if (honeypotInfo !== undefined) {
    info.tokenName =
      honeypotInfo.tokenName?.replaceAll(".", "\\.") ?? "unknown name";
    info.tokenSymbol =
      honeypotInfo.tokenSymbol?.replaceAll(".", "\\.") ?? "unknown name";
  }

  await sendTelegramMessage1(info);
}

async function isContractVerified(tokenAddress) {
  try {
    const response = await axios.get("https://api.etherscan.io/api", {
      params: {
        module: "contract",
        action: "getabi",
        address: tokenAddress,
        apikey: etherScanApiKey,
      },
    });

    const data = response.data;

    console.log("get abi: ", data.status, "-", data.message);

    return data.status == "1" && data.message == "OK";
  } catch (error) {
    console.error(error);
  }
}

async function getHoneypot(tokenAddress) {
  try {
    const response = await axios.get(
      "https://app.quickintel.io/api/quicki/gethoneypot",
      {
        headers: {
          Host: "app.quickintel.io",
          authority: "app.quickintel.io",
          address: tokenAddress,
          exchange: "uniswap2",
          pairedtoken: "default",
          referer: "https://app.quickintel.io/scanner",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        },
      }
    );

    const data = response.data.data;

    console.log(data.tokenName, "-", data.tokenSymbol);

    return data;
  } catch (error) {
    console.error(error);
  }
}

async function getNumberOfTokenTransanferOfPair(pairAddress) {
  try {
    const response = await axios.get("https://api.etherscan.io/api", {
      params: {
        module: "account",
        action: "tokentx",
        address: pairAddress,
        sort: "desc",
        apikey: etherScanApiKey,
      },
    });

    const data = response.data;

    if (data.status == "1") {
      const transactions = data.result;
      const groupedMap = transactions.reduce(
        (entryMap, e) =>
          entryMap.set(e.hash, [...(entryMap.get(e.hash) || []), e]),
        new Map()
      );
      console.log("num tx: ", groupedMap.size);
      return groupedMap.size;
    } else {
      console.log("Cannot get list of token transaction in pair");
      console.log(data);
      return 0;
    }
  } catch (error) {
    console.error(error);
  }
}

// async function getQuickIntelReport(tokenAddress) {
//     try {
//         const response = await axios.post(
//             'https://app.quickintel.io/api/quicki/getquickiaudit',
//             {
//                 chain: 'eth',
//                 tokenAddress: tokenAddress,
//                 tier: 'vip',
//                 nft: false
//             },
//             {
//                 headers: {
//                     'Host': 'app.quickintel.io',
//                     'Content-Type': 'text/plain',
//                     'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
//                 }
//             }
//         )

//         const data = response.data

//         return {
//             contractVerified: data.contractVerified,
//             canUpdateFees: data.quickiAudit.can_Update_Fees,
//             canBlacklist: data.quickiAudit.can_Blacklist,
//             canMultiBlacklist: data.quickiAudit.can_MultiBlacklist,
//             canWhitelist: data.quickiAudit.can_Whitelist,
//             onlyOwnerFunctions: data.quickiAudit.onlyOwner_Functions,
//             hasScams: data.quickiAudit.has_Scams
//         }

//     } catch (error) {
//         console.error(error);
//         return {
//             contractVerified: false
//         }
//     }
// }

function getTeleMessageText(info) {
  let etherScanURL = `https://etherscan.io/token/${info.tokenAddress}`;
  let quickIntelURL = `https://app.quickintel.io/scanner?type=token&chain=eth&contractAddress=${info.tokenAddress}`;
  let dexToolsURL = `https://www.dextools.io/app/en/ether/pair-explorer/${info.pairAddress}`;

  const message = `
    🔹 \\| ${info.tokenName} \\| ${info.tokenSymbol} \\|
    🔹 CA: \`${info.tokenAddress}\`
    🔹 Pair: \`${info.pairAddress}\`
    [EtherScan](${etherScanURL})
    [DexTools](${dexToolsURL})
    [QuicIntel](${quickIntelURL})
    `;

  return message.replaceAll("-", "\\-");
}

async function sendTelegramMessage1(info) {
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  const messText = getTeleMessageText(info);

  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        params: {
          chat_id: -1001942290221,
          parse_mode: "MarkdownV2",
          disable_web_page_preview: true,
          text: messText,
        },
      }
    );

    const data = response.data;

    if (data.ok) {
      console.log("Send Telegram message success");
    } else {
      console.log(data);
    }
    console.log("--------");
    console.log("\n");
  } catch (error) {
    console.error(error);
  }
}
