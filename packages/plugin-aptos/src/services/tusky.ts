const TUS_API_URL = 'https://api.tusky.io'
const TUS_API_KEY = '0eccf2a3-0be1-471e-a6d2-ab24da6678a3'
const DEFAULT_VAULT = '2ad303cc-ac28-404b-9b30-fb742e3b036f'
const DEFAULT_PARENT_ID = '45c6c728-6e0d-4260-8c2e-1bb25d285874'

function generateRandomString(length: number): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    const charactersLength = characters.length
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength))
    }
    return result
}

//to check that user have been created a folder and create if not
export async function checkUserFolder(folderName: string) {
    if (!TUS_API_URL || !TUS_API_KEY) {
        throw new Error('TUS_API_URL or TUSKY_API_KEY is not set')
    }
    const folders = await fetch(
        `${TUS_API_URL}/folders?vaultId=${DEFAULT_VAULT}&parentId=${DEFAULT_PARENT_ID}`,
        {
            method: 'GET',
            headers: {
                'Api-key': TUS_API_KEY,
            },
        },
    ).then((response) => response.json())

    const folder = folders.items.find((folder: any) => folder.name == folderName)

    if (folder) {
        return folder
    } else {
        return createFolder(folderName)
    }
}

export async function getFolderByUserAddressTmp(userAddress: string) {
    if (!TUS_API_URL || !TUS_API_KEY) return 'TUS_API or TUSKY_API_KEY is not set'
    // const folder = await checkUserFolder(userAddress)

    const response = await fetch(`${TUS_API_URL}/files?vaultId=${DEFAULT_VAULT}&parentId=${DEFAULT_PARENT_ID}`, {
      method: 'GET',
      headers: {
        'Api-Key': TUS_API_KEY,
      },
    }).then((response) => response.json())
    console.log(response)

    const data = await Promise.all(
      response.items.map(async (item: any) => {
        const file = await getDataByID(item.id)
        return {
          ...item,
          data: file,
        }
      }),
    )

    return data;
  }

export async function getFilesByParentId(parentId: string) {
    if (!TUS_API_URL || !TUS_API_KEY) {
      throw new Error("TUS_API_URL or TUSKY_API_KEY is not set");
    }
  
    const response = await fetch(
      `${TUS_API_URL}/files?vaultId=${DEFAULT_VAULT}&parentId=${parentId}`,
      {
        method: "GET",
        headers: {
          "Api-Key": TUS_API_KEY,
        },
      }
    ).then((response) => response.json());
  
    const data = await Promise.all(
      response.items.map(async (item: any) => {
        const file = await getDataByID(item.id);
        return {
          ...item,
          data: file,
        };
      })
    );
  
    return data;
  }
  

export async function getFolderByUserAddress(userAddress: string) {
    if (!TUS_API_URL || !TUS_API_KEY) {
        throw new Error('TUS_API_URL or TUSKY_API_KEY is not set')
    }

    const folder = await checkUserFolder(userAddress)

    const response = await fetch(`${TUS_API_URL}/files?vaultId=${DEFAULT_VAULT}&parentId=${folder.id}`, {
        method: 'GET',
        headers: {
            'Api-key': TUS_API_KEY,
        },
    }).then((response) => response.json())

    const data = await Promise.all(
        response.items.map(async (item: any) => {
            const file = await getDataByID(item.id)
            return {
                ...item,
                data: file,
            }
        }),
    )
    return data;
}

// create vault to store files, Vaults in Tusky are secure storage containers for files.
export async function createVault(vaultName: string) {
    try {
        if (!TUS_API_URL || !TUS_API_KEY) {
            throw new Error('TUS_API_URL or TUS_API_KEY is not set')
        }

        const response = await fetch(`${TUS_API_URL}/vaults`, {
            method: 'POST',
            headers: {
                'Api-key': TUS_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: vaultName,
            }),
        })

        const vault = await response.json()

        return vault
    } catch (err) {
        throw err;
    }
}

//get file binary data from id
export async function getDataByID(id: string) {
    try {
        if (!TUS_API_URL || !TUS_API_KEY) {
            throw new Error('TUS_API_URL or TUS_API_KEY is not set')
        }
        const response = await fetch(`${TUS_API_URL}/files/${id}/data`, {
            headers: {
                'Api-key': TUS_API_KEY,
            },
        })
        return await response.json()
    } catch (err) {
        throw err;
    }
}

// get all file by a vault
export async function getDataFromVault(vaultId: string) {
    try {
        if (!TUS_API_URL || !TUS_API_KEY) {
            throw new Error('TUS_API_URL or TUSKY_API_KEY is not set')
        }

        const response = await fetch(`${TUS_API_URL}/files?vaultId=${vaultId}`, {
            headers: {
                'Api-key': TUS_API_KEY,
            },
        })

        const data = await response.json()
        return data?.items
    } catch (error) {
        throw error
    }
}

export async function createFolder(folderName: string) {
    try {
        if (!TUS_API_URL || !TUS_API_KEY) {
            throw new Error('TUS_API_URL or TUSKY_API_KEY is not set')
        }

        const response = await fetch(`${TUS_API_URL}/folders`, {
            method: 'POST',
            headers: {
                'Api-key': TUS_API_KEY,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: folderName,
                vaultId: DEFAULT_VAULT,
                parentId: DEFAULT_PARENT_ID,
            }),
        })

        const folder = await response.json()

        return folder
    } catch (error) {
        throw error
    }
}

interface TransformedData {
  categories: {
    id: string;
    content: string[];
    count: number;
  }[];
  totalPosts: number;
}

const CATEGORY_KEYWORDS = {
  CRYPTO: ['crypto', 'bitcoin', 'eth', '$', 'btc', 'nft', 'web3', 'airdrop', 'token', 'memecoin', 'blockchain', 'wallet', 'sui', 'solana'],
  ML_AI: ['ai', 'ml', 'model', 'grok', 'neural', 'chat', 'bot', 'xai'],
  DEVELOPMENT: ['dev', 'code', 'protocol', 'extension', 'api', 'sdk', 'framework', 'smartcontract', 'dapp'],
  DEFI: ['defi', 'finance', 'payment', 'trading', 'swap', 'yield', 'lending', 'staking'],
  SOCIAL: ['twitter', 'social', 'community', 'follow', 'rt', 'like', 'engagement', '@'],
  MARKET: ['market', 'price', 'pump', 'dump', 'bull', 'bear', 'trend', 'season', 'altcoin'],
  NEWS: ['news', 'update', 'announcement', 'launch', 'release', 'progress'],
  GAMING: ['game', 'gaming', 'play', 'reward', 'naruto'],
  EVENTS: ['event', 'hackathon', 'competition', 'prize', 'pool', 'register', 'join']
};

const checkPostCategory = (post: string, keywords: string[]): boolean => {
  return keywords.some(keyword => post.toLowerCase().includes(keyword));
};

export async function getTransformedUserData(userAddress: string): Promise<TransformedData> {
  // Lấy data từ Tusky API
  const rawData = await getFolderByUserAddress(userAddress);
  
  // Xử lý data để lấy ra các posts
  const posts = rawData.map((item: any) => {
    const data = item.data;
    if (Array.isArray(data)) {
      return data.map(i => i.text || i.msg).filter(Boolean);
    } else if (typeof data === 'object' && data !== null) {
      return data.text || data.msg || '';
    }
    return '';
  }).flat().filter(Boolean);

  // Phân loại posts theo categories
  const categorizedPosts: { [key: string]: string[] } = {
    Crypto: [],
    'ML/AI': [],
    Development: [],
    DeFi: [],
    Social: [],
    Market: [],
    News: [],
    Gaming: [],
    Events: [],
    Other: []
  };

  posts.forEach(post => {
    let categorized = false;
    
    if (checkPostCategory(post, CATEGORY_KEYWORDS.CRYPTO)) {
      categorizedPosts.Crypto.push(post);
      categorized = true;
    }
    if (checkPostCategory(post, CATEGORY_KEYWORDS.ML_AI)) {
      categorizedPosts['ML/AI'].push(post);
      categorized = true;
    }
    if (checkPostCategory(post, CATEGORY_KEYWORDS.DEVELOPMENT)) {
      categorizedPosts.Development.push(post);
      categorized = true;
    }
    if (checkPostCategory(post, CATEGORY_KEYWORDS.DEFI)) {
      categorizedPosts.DeFi.push(post);
      categorized = true;
    }
    if (checkPostCategory(post, CATEGORY_KEYWORDS.SOCIAL)) {
      categorizedPosts.Social.push(post);
      categorized = true;
    }
    if (checkPostCategory(post, CATEGORY_KEYWORDS.MARKET)) {
      categorizedPosts.Market.push(post);
      categorized = true;
    }
    if (checkPostCategory(post, CATEGORY_KEYWORDS.NEWS)) {
      categorizedPosts.News.push(post);
      categorized = true;
    }
    if (checkPostCategory(post, CATEGORY_KEYWORDS.GAMING)) {
      categorizedPosts.Gaming.push(post);
      categorized = true;
    }
    if (checkPostCategory(post, CATEGORY_KEYWORDS.EVENTS)) {
      categorizedPosts.Events.push(post);
      categorized = true;
    }
    
    if (!categorized) {
      categorizedPosts.Other.push(post);
    }
  });

  // Transform thành format mới
  const transformedData: TransformedData = {
    categories: Object.entries(categorizedPosts)
      .filter(([_, posts]) => posts.length > 0)
      .map(([category, posts]) => ({
        id: category,
        content: posts,
        count: posts.length
      })),
    totalPosts: posts.length
  };

  return transformedData;
}
