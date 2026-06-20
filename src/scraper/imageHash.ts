import Jimp from "jimp";

/**
 * Converte uma string hexadecimal em binária
 */
export function hexToBinary(hex: string): string {
  let bin = "";
  for (let i = 0; i < hex.length; i++) {
    bin += parseInt(hex[i], 16).toString(2).padStart(4, "0");
  }
  return bin;
}

/**
 * Calcula a Distância de Hamming entre dois hashes em formato hexadecimal.
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (!hash1 || !hash2 || hash1.length !== 16 || hash2.length !== 16) return 999;
  const bin1 = hexToBinary(hash1);
  const bin2 = hexToBinary(hash2);
  let distance = 0;
  for (let i = 0; i < 64; i++) {
    if (bin1[i] !== bin2[i]) distance++;
  }
  return distance;
}

/**
 * Calcula o Perceptual Hash (dHash) de uma imagem salva no disco local usando Jimp.
 */
export async function getPerceptualHash(imagePath: string): Promise<string> {
  try {
    const image = await Jimp.read(imagePath);
    
    // 1. Redimensiona para 9x8 ignorando proporções
    image.resize(9, 8);
    // 2. Converte para escala de cinza
    image.greyscale();

    const grays: number[] = [];
    
    // Extrai a luminância de cada pixel (Jimp já deixou em tons de cinza, então R = G = B)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 9; x++) {
        const color = image.getPixelColor(x, y);
        const r = (color >> 24) & 255;
        grays.push(r);
      }
    }

    // Calcula o dHash comparando o pixel da esquerda com o da direita
    let hash = "";
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const leftIndex = y * 9 + x;
        const rightIndex = leftIndex + 1;
        if (grays[leftIndex] > grays[rightIndex]) {
          hash += "1";
        } else {
          hash += "0";
        }
      }
    }

    // Converte binário para hexadecimal
    let hexHash = "";
    for (let i = 0; i < hash.length; i += 4) {
      const nibble = hash.substring(i, i + 4);
      hexHash += parseInt(nibble, 2).toString(16);
    }

    return hexHash;
  } catch (err) {
    throw new Error(`Erro ao calcular hash da imagem: ${err}`);
  }
}
