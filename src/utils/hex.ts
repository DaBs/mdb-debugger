export const convertNumberToHex = (number: number) => `0x${number.toString(16)}`;

export const convertHexToNumber = (hexString: string) => parseInt(hexString, 16);