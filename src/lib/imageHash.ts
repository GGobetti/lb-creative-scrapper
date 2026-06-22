/**
 * Calcula o Perceptual Hash (dHash) de uma imagem a partir de sua URL.
 * O dHash reduz a imagem para 9x8 em escala de cinza e compara pixels adjacentes,
 * gerando um hash de 64-bits imune a leves redimensionamentos ou compressões jpeg.
 */
export async function getPerceptualHash(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Tenta usar crossOrigin para não ter erro de CORS se a imagem suportar
    img.crossOrigin = "Anonymous";

    img.onload = () => {
      // 1. Cria um canvas pequeno 9x8
      const canvas = document.createElement("canvas");
      canvas.width = 9;
      canvas.height = 8;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return reject(new Error("Não foi possível acessar o contexto 2D do Canvas."));

      // 2. Desenha a imagem no canvas, forçando-a a caber em 9x8 pixels (esmagando proporções)
      ctx.drawImage(img, 0, 0, 9, 8);

      // 3. Pega os pixels em escala de cinza
      const imageData = ctx.getImageData(0, 0, 9, 8);
      const data = imageData.data;
      const grays: number[] = [];

      // ImageData contém os pixels RGBA: data[i] = R, data[i+1] = G, data[i+2] = B, data[i+3] = A
      for (let i = 0; i < data.length; i += 4) {
        // Luminância clássica
        const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        grays.push(gray);
      }

      // 4. Calcula o dHash comparando o pixel da esquerda com o da direita
      // Se pixel esquerdo > pixel direito = 1, senão = 0
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

      // Converte o binário (64 caracteres) para hexadecimal (16 caracteres)
      // para ficar menor no banco de dados
      let hexHash = "";
      for (let i = 0; i < hash.length; i += 4) {
        const nibble = hash.substring(i, i + 4);
        hexHash += parseInt(nibble, 2).toString(16);
      }

      resolve(hexHash);
    };

    img.onerror = () => {
      reject(new Error("Falha ao carregar a imagem para calcular o hash."));
    };

    img.src = imageUrl;
  });
}

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
 * Retorna o número de bits diferentes.
 * Geralmente uma distância <= 10 indica que as imagens são visualmente muito semelhantes ou idênticas (com leve redimensionamento/ruído).
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
