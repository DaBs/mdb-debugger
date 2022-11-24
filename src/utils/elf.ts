/*
 * Class to load an 32bit ELF file and get the main file parameters.
 *
 * DOES NOT SUPPORT 64 BIT ELF - due to lack of native 64bit values in Typescript /  Javascript.
 * It still tries to load 64 bit ELF, but this only works if the upper 32bit of all 64bit values ar zero.
 *
 * Sunshine2k, January 2019
 * www.sunshine2k.de | www.bastian-molkenthin.de
 *
 * History:
 * 2019-01-04: Initial release.
 * 2019-03-28: Added compact mode
 */

    export enum ELFFileLoadResult
    {
        OK,
        INVALID_ELF
    }

    /**
     * Class to access the content of a loaded ELF file.
     */
    export class ELFFileAccess
    {
        private fileContent: ArrayBuffer;
        private dataViewer: DataView;
        private littleEndian: boolean;

        constructor(fileBytes: ArrayBuffer)
        {
            this.fileContent = fileBytes;
            this.dataViewer = new DataView(fileBytes);
            this.littleEndian = false; /* big-endian by default */
        }

        public setLittleEndian(le: boolean)
        {
            this.littleEndian = le;
        }

        public isLittleEndian(): boolean
        {
            return this.littleEndian;
        }

        public getDataView(): DataView
        {
            return this.dataViewer;
        }

        public getFileContent(): ArrayBuffer
        {
            return this.fileContent;
        }

        public ReadByteString(strStartOffset: number, strMaxLength: number): string
        {
            /* find actual length of string - null-terminated */
            let length: number = strMaxLength;
            for (let i: number = 0; i < strMaxLength; i++)
            {
                if (strStartOffset + i >= this.dataViewer.byteLength || this.dataViewer.getUint8(strStartOffset + i) == 0)
                {
                    length = i;
                    break;
                }
            }

            /* read string */
            let str: string = "";
            for (let i: number = 0; i < length; i++)
            {
                str = str + String.fromCharCode(this.dataViewer.getUint8(strStartOffset + i));
            }

            return str;
        }
    }

    /**
     * Represents one element of an ELF file with it's file offset and value.
     */
    export class ELFElement
    {
        public offset: number;
        public value: number;
        public value2!: number; /* second part of number in case of 64bit number */
        public valueSizeInBytes: number;
        public description: () => string;
        private FA: ELFFileAccess;

        constructor(fa: ELFFileAccess, offset: number, valueSizeInBytes: number)
        {
            if (valueSizeInBytes == 1)
            {
                this.value = fa.getDataView().getUint8(offset);
            }
            else if (valueSizeInBytes == 2)
            {
                this.value = fa.getDataView().getUint16(offset, fa.isLittleEndian());
            }
            else if (valueSizeInBytes == 4)
            {
                this.value = fa.getDataView().getUint32(offset, fa.isLittleEndian());
            }
            else if (valueSizeInBytes == 8)
            {
                /* no native support for 64 bit values */
                this.value =  fa.getDataView().getUint32(offset, fa.isLittleEndian());
                this.value2 = fa.getDataView().getUint32(offset + 4, fa.isLittleEndian());
            }
            else
            {
                this.value = 0;
            }

            this.offset = offset;
            this.valueSizeInBytes = valueSizeInBytes;
            this.description = () => "";
            this.FA = fa;
        }

        public GetHexValueStr(paddingLength: number): string
        {
            if (this.valueSizeInBytes <= 4)
            {
                return "0x" + ("00000000" + this.value.toString(16).toUpperCase()).slice(-paddingLength);
            }
            else
            {
                /* 64 bit */
                if (this.FA.isLittleEndian())
                {
                    return "0x" + ("00000000" + this.value2.toString(16).toUpperCase()).slice(-8) +
                        ("00000000" + this.value.toString(16).toUpperCase()).slice(-8);
                }
                else
                {
                    
                    return "0x" + ("00000000" + this.value.toString(16).toUpperCase()).slice(-8) +
                        ("00000000" + this.value2.toString(16).toUpperCase()).slice(-8);
                }
            }
        }

        public Get32BitValue(): number
        {
            if (this.valueSizeInBytes <= 4)
            {
                return this.value;
            }
            else
            {
                /* return the least significant 32 bits for 64 bit ELF */
                let retVal: number = this.FA.isLittleEndian() ? this.value : this.value2;
                return retVal;
            }
        }
    }

    /**
     * ELF file header
     */
    export class ELFHeader
    {
        private FA: ELFFileAccess;

        public E_ident_mag!: ELFElement;
        public E_ident_class!: ELFElement;
        public E_ident_data!: ELFElement;
        public E_ident_version!: ELFElement;
        public E_ident_OsAbi!: ELFElement;
        public E_ident_OsAbiVer!: ELFElement;

        public E_type!: ELFElement;
        public E_machine!: ELFElement;
        public E_version!: ELFElement;
        public E_Entry!: ELFElement;
        public E_PhOff!: ELFElement;
        public E_ShOff!: ELFElement;
        public E_Flags!: ELFElement;
        public E_Ehsize!: ELFElement;
        public E_Phentsize!: ELFElement;
        public E_Phnum!: ELFElement;
        public E_Shentsize!: ELFElement;
        public E_Shnum!: ELFElement;
        public E_Shstrndx!: ELFElement;

        constructor(fileAccess: ELFFileAccess)
        {
            this.FA = fileAccess;
        }

        public load(): ELFFileLoadResult
        {
            if (this.FA.getDataView().byteLength < 52) return ELFFileLoadResult.INVALID_ELF;
            let curOff: number = 0;

            this.E_ident_mag = new ELFElement(this.FA, curOff, 4);
            curOff += 4;

            this.E_ident_class = new ELFElement(this.FA, curOff, 1);
            this.E_ident_class.description = () =>
            {
                switch (this.E_ident_class.value)
                {
                    case 0: return "NONE"; break;
                    case 1: return "32 BIT"; break;
                    case 2: return "64 BIT"; break;
                    default: return "INVALID"; break;
                }
            }
            curOff++;

            this.E_ident_data = new ELFElement(this.FA, curOff, 1);
            this.E_ident_data.description = () =>
            {
                switch (this.E_ident_data.value)
                {
                    case 0: return "NONE"; break;
                    case 1: return "DATA2LSB (Little-Endian)"; break;
                    case 2: return "DATA2MSB (Big-Endian)"; break;
                    default: return "INVALID"; break;
                }
            }
            this.FA.setLittleEndian(this.E_ident_data.value == 1);
            curOff++;

            this.E_ident_version = new ELFElement(this.FA, curOff, 1);
            this.E_ident_version.description = () =>
            {
                switch (this.E_ident_version.value)
                {
                    case 0: return "EV_NONE"; break;
                    case 1: return "EV_CURRENT"; break;
                    default: return "INVALID"; break;
                }
            }
            curOff++;

            this.E_ident_OsAbi = new ELFElement(this.FA, curOff, 1);
            this.E_ident_OsAbi.description = () =>
            {
                switch (this.E_ident_OsAbi.value)
                {
                    case 0: return "UNIX System V ABI"; break;
                    case 1: return "HP-UX operating system"; break;
                    case 255: return "Standalone (embedded) application"; break;
                    default: return "Unknown"; break;
                }
            }
            curOff++;

            this.E_ident_OsAbiVer = new ELFElement(this.FA, curOff, 1);
            curOff++;

            curOff = 16;
            this.E_type = new ELFElement(this.FA, curOff, 2);
            this.E_type.description = () => { return this.getDescription_EType() };
            curOff += 2;

            this.E_machine = new ELFElement(this.FA, curOff, 2);
            this.E_machine.description = () => { return this.getDescription_EMachine() };
            curOff += 2;

            this.E_version = new ELFElement(this.FA, curOff, 4);
            this.E_version.description = () =>
            {
                switch (this.E_version.value)
                {
                    case 0: return "EV_NONE"; break;
                    case 1: return "EV_CURRENT"; break;
                    default: return "INVALID"; break;
                }
            }
            curOff += 4;

            if (this.isELF64())
            {
                this.E_Entry = new ELFElement(this.FA, curOff, 8);
                curOff += 8;
                this.E_PhOff = new ELFElement(this.FA, curOff, 8);
                curOff += 8;
                this.E_ShOff = new ELFElement(this.FA, curOff, 8);
                curOff += 8;
            }
            else
            {
                this.E_Entry = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
                this.E_PhOff = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
                this.E_ShOff = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
            }

            this.E_Flags = new ELFElement(this.FA, curOff, 4);
            curOff += 4;

            this.E_Ehsize = new ELFElement(this.FA, curOff, 2);
            curOff += 2;
            this.E_Phentsize = new ELFElement(this.FA, curOff, 2);
            curOff += 2;
            this.E_Phnum = new ELFElement(this.FA, curOff, 2);
            curOff += 2;
            this.E_Shentsize = new ELFElement(this.FA, curOff,2);
            curOff += 2;
            this.E_Shnum = new ELFElement(this.FA, curOff, 2);
            curOff += 2;
            this.E_Shstrndx = new ELFElement(this.FA, curOff, 2);
            curOff += 2;

            return ELFFileLoadResult.OK;
        }

        public isELF64() : boolean
        {
            return this.E_ident_class.value == 2;
        }

        public GetSectionNameStringTableIndex() : number
        {
            return this.E_Shstrndx.value;
        }

        private getDescription_EType(): string
        {
            switch (this.E_type.value)
            {
                case 0: return "ET_NONE (No file type)"; break;
                case 1: return "ET_REL (Relocatable file)"; break;
                case 2: return "ET_EXEC (Executable file)"; break;
                case 3: return "ET_DYN (Shared object file)"; break;
                case 4: return "ET_CORE (Core file)"; break;
                case 0xFE00: return "ET_LOOS (Processor-specific)"; break;
                case 0xFEFF: return "ET_HIOS (Processor-specific)"; break;
                case 0xFF00: return "ET_LOPROC (Processor-specific)"; break;
                case 0xFFFF: return "ET_HIPROC (Processor-specific)"; break;
                default: return "Unknown"; break;
            }
        }

        private getDescription_EMachine(): string
        {
            switch (this.E_machine.value)
            {
                case 0: return "EM_NONE (No machine)"; break;
                case 1: return "EM_M32 (AT&T WE 32100)"; break;
                case 2: return "EM_SPARC (SPARC)"; break;
                case 3: return "EM_386 (Intel 80386)"; break;
                case 4: return "EM_68K (Motorola 68000)"; break;
                case 5: return "EM_88K (Motorola 88000)"; break;
                case 6: return "RESERVED (Reserved for future use)"; break;
                case 7: return "EM_860 (Intel 80860)"; break;
                case 8: return "EM_MIPS (MIPS I Architecture)"; break;
                case 9: return "EM_S370 (IBM System/ 370 Processor)"; break;
                case 10: return "EM_MIPS_RS3_LE (MIPS RS3000 Little-endian)"; break;
                case 11: return "RESERVED (Reserved for future use)"; break;
                case 12: return "RESERVED (Reserved for future use)"; break;
                case 13: return "RESERVED (Reserved for future use)"; break;
                case 14: return "RESERVED (Reserved for future use)"; break;
                case 15: return "EM_PARISC (Hewlett- Packard PA- RISC)"; break;
                case 16: return "RESERVED (Reserved for future use)"; break;
                case 17: return "EM_VPP500 (Fujitsu VPP500)"; break;
                case 18: return "EM_SPARC32PS (Enhanced instruction set SPARC)"; break;
                case 19: return "EM_960 (Intel 80960)"; break;
                case 20: return "EM_PPC (PowerPC)"; break;
                case 21: return "EM_PPC64 (64-bit PowerPC)"; break;
                case 22: return "EM_S390 (IBM System/390 Processor)"; break;
                case 23: return "RESERVED (Reserved for future use)"; break;
                case 24: return "RESERVED (Reserved for future use)"; break;
                case 25: return "RESERVED (Reserved for future use)"; break;
                case 26: return "RESERVED (Reserved for future use)"; break;
                case 27: return "RESERVED (Reserved for future use)"; break;
                case 28: return "RESERVED (Reserved for future use)"; break;
                case 29: return "RESERVED (Reserved for future use)"; break;
                case 30: return "RESERVED (Reserved for future use)"; break;
                case 31: return "RESERVED (Reserved for future use)"; break;
                case 32: return "RESERVED (Reserved for future use)"; break;
                case 33: return "RESERVED (Reserved for future use)"; break;
                case 34: return "RESERVED (Reserved for future use)"; break;
                case 35: return "RESERVED (Reserved for future use)"; break;
                case 36: return "EM_V800(NEC V800)"; break;
                case 37: return "EM_FR20(Fujitsu FR20)"; break;
                case 38: return "EM_RH32(TRW RH- 32)"; break;
                case 39: return "EM_RCE (Motorola RCE)"; break;
                case 40: return "EM_ARM (Advanced RISC Machines ARM)"; break;
                case 41: return "EM_ALPHA (Digital Alpha)"; break;
                case 42: return "EM_SH (Hitachi SH)"; break;
                case 43: return "EM_SPARCV9 (SPARC Version 9)"; break;
                case 44: return "EM_TRICORE (Siemens TriCore embedded processor)"; break;
                case 45: return "EM_ARC (Argonaut RISC Core, Argonaut Technologies Inc.)"; break;
                case 46: return "EM_H8_300 (Hitachi H8/ 300)"; break;
                case 47: return "EM_H8_300H (Hitachi H8/ 300H)"; break;
                case 48: return "EM_H8S (Hitachi H8S)"; break;
                case 49: return "EM_H8_500 (Hitachi H8/ 500)"; break;
                case 50: return "EM_IA_64 (Intel IA- 64 processor architecture)"; break;
                case 51: return "EM_MIPS_X (Stanford MIPS- X)"; break;
                case 52: return "EM_COLDFIRE (Motorola ColdFire)"; break;
                case 53: return "EM_68HC12 (Motorola M68HC12)"; break;
                case 54: return "EM_MMA (Fujitsu MMA Multimedia Accelerator)"; break;
                case 55: return "EM_PCP (Siemens PCP)"; break;
                case 56: return "EM_NCPU (Sony nCPU embedded RISC processor)"; break;
                case 57: return "EM_NDR1 (Denso NDR1 microprocessor)"; break;
                case 58: return "EM_STARCORE (Motorola Star* Core processor)"; break;
                case 59: return "EM_ME16 (Toyota ME16 processor)"; break;
                case 60: return "EM_ST100 (STMicroelectronics ST100 processor)"; break;
                case 61: return "EM_TINYJ (Advanced Logic Corp.TinyJ embedded processor family)"; break;
                case 62: return "EM_X86_64 (AMD x86- 64 architecture)"; break;
                case 63: return "EM_PDSP (Sony DSP Processor)"; break;
                case 64: return "EM_PDP10 (Digital Equipment Corp.PDP - 10)"; break;
                case 65: return "EM_PDP11 (Digital Equipment Corp.PDP - 11)"; break;
                case 66: return "EM_FX66 (Siemens FX66 microcontroller)"; break;
                case 67: return "EM_ST9PLUS (STMicroelectronics ST9+ 8 / 16 bit microcontroller)"; break;
                case 68: return "EM_ST7 (STMicroelectronics ST7 8- bit microcontroller)"; break;
                case 69: return "EM_68HC16 (Motorola MC68HC16 Microcontroller)"; break;
                case 70: return "EM_68HC11 (Motorola MC68HC11 Microcontroller)"; break;
                case 71: return "EM_68HC08 (Motorola MC68HC08 Microcontroller)"; break;
                case 72: return "EM_68HC05 (Motorola MC68HC05 Microcontroller)"; break;
                case 73: return "EM_SVX (Silicon Graphics SVx)"; break;
                case 74: return "EM_ST19 (STMicroelectronics ST19 8- bit microcontroller)"; break;
                case 75: return "EM_VAX (Digital VAX)"; break;
                case 76: return "EM_CRIS (Axis Communications 32- bit embedded processor)"; break;
                case 77: return "EM_JAVELIN (Infineon Technologies 32- bit embedded processor)"; break;
                case 78: return "EM_FIREPATH (Element 14 64- bit DSP Processor)"; break;
                case 79: return "EM_ZSP (LSI Logic 16- bit DSP Processor)"; break;
                case 80: return "EM_MMIX (Donald Knuth's educational 64-bit processor)"; break;
                case 81: return "EM_HUANY (Harvard University machine- independent object files)"; break;
                case 82: return "EM_PRISM (SiTera Prism)"; break;
                case 83: return "EM_AVR (Atmel AVR 8- bit microcontroller)"; break;
                case 84: return "EM_FR30 (Fujitsu FR30)"; break;
                case 85: return "EM_D10V (Mitsubishi D10V)"; break;
                case 86: return "EM_D30V (Mitsubishi D30V)"; break;
                case 87: return "EM_V850 (NEC v850)"; break;
                case 88: return "EM_M32R (Mitsubishi M32R)"; break;
                case 89: return "EM_MN10300(Matsushita MN10300)"; break;
                case 90: return "EM_MN10200(Matsushita MN10200)"; break;
                case 91: return "EM_PJ (picoJava)"; break;
                case 92: return "EM_OPENRISC (OpenRISC 32- bit embedded processor)"; break;
                case 93: return "EM_ARC_A5 (ARC Cores Tangent- A5)"; break;
                case 94: return "EM_XTENSA (Tensilica Xtensa Architecture)"; break;
                case 95: return "EM_VIDEOCORE (Alphamosaic VideoCore processor)"; break;
                case 96: return "EM_TMM_GPP (Thompson Multimedia General Purpose Processor)"; break;
                case 97: return "EM_NS32K (National Semiconductor 32000 series)"; break;
                case 98: return "EM_TPC (Tenor Network TPC processor)"; break;
                case 99: return "EM_SNP1K (Trebia SNP 1000 processor)"; break;
                case 100: return "EM_ST200 (STMicroelectronic)"; break;
                default: return "Unknown"; break;
            }
        }
    }

    /**
     * ELF section table
     */
    export class ELFSectionHeaderTable
    {
        private FA: ELFFileAccess;
        public headerIndex: number;
        private elfFile: ELFFile;

        public Sh_Name!: ELFElement;
        public Sh_Type!: ELFElement;
        public Sh_Flags!: ELFElement;
        public Sh_Addr!: ELFElement;
        public Sh_Offset!: ELFElement;
        public Sh_Size!: ELFElement;
        public Sh_Link!: ELFElement;
        public Sh_Info!: ELFElement;
        public Sh_Addralign!: ELFElement;
        public Sh_Entsize!: ELFElement;

        public static SHT_NULL: number = 0;
        public static SHT_PROGBITS: number = 1;
        public static SHT_SYMTAB: number = 2;
        public static SHT_STRTAB: number = 3;
        public static SHT_RELA: number = 4;
        public static SHT_HASH: number = 5;
        public static SHT_DYNAMIC: number = 6;
        public static SHT_NOTE: number = 7;
        public static SHT_NOBITS: number = 8;
        public static SHT_REL: number = 9;
        public static SHT_SHLIB: number = 10;
        public static SHT_DYNSYM: number = 11;
        public static SHT_INIT_ARRAY: number = 14;
        public static SHT_FINI_ARRAY: number = 15;
        public static SHT_PREINIT_ARRAY: number = 16;
        public static SHT_GROUP: number = 17;
        public static SHT_SYMTAB_SHNDX: number = 18;

        public static SHF_W: number                 = 0x01; /* Contains writable data */
        public static SHF_ALLOC: number             = 0x02; /* Write permission */
        public static SHF_EXECINSTR: number         = 0x04; /* Contains executable instructions */
        public static SHF_MERGE: number             = 0x10; /* Can be merge to eliminate duplicate */
        public static SHF_STRINGS: number           = 0x20; /* Contains null-terminated character strings */
        public static SHF_INFO_LINK: number         = 0x40; /* Sh_info field has section header table index */
        public static SHF_LINK_ORDER: number        = 0x80; /* Contains special ordering requirements */
        public static SHF_OS_NONCONFORMING: number  = 0x100; /* Requires requires special OS-specific processing */
        public static SHF_GROUP: number             = 0x200; /* Member of section group */
        public static SHF_TLS: number               = 0x400; /* Contains thread-local storage */
        public static SHF_AMD64_LARGE: number       = 0x10000000; /* Has more than 2 Gbyte */
        public static SHF_ORDERED: number           = 0x40000000; /* Ordered */
        public static SHF_EXCLUDE: number           = 0x80000000; /* Excluded */
        public static SHF_MASKPROC: number          = 0xF0000000; /* Reserved processor-specific bit mask */

        constructor(headerIndex: number, fileAccess: ELFFileAccess, elfFile: ELFFile)
        {
            this.FA = fileAccess;
            this.headerIndex = headerIndex;
            this.elfFile = elfFile;
        }

        public load(startAddress: number): void
        {
            let curOff: number = startAddress;
            let elemSize: number = this.elfFile.elfHeader.isELF64() ? 8 : 4;

            this.Sh_Name = new ELFElement(this.FA, curOff, 4);
            this.Sh_Name.description = () => { return this.getDescription_Name() };
            curOff += 4;
            this.Sh_Type = new ELFElement(this.FA, curOff, 4);
            this.Sh_Type.description = () => { return this.getDescription_Type() };
            curOff += 4;

            this.Sh_Flags = new ELFElement(this.FA, curOff, elemSize);
            this.Sh_Flags.description = () => { return this.getDescription_Flags() };
            curOff += elemSize;
            this.Sh_Addr = new ELFElement(this.FA, curOff, elemSize);
            curOff += elemSize;
            this.Sh_Offset = new ELFElement(this.FA, curOff, elemSize);
            curOff += elemSize;
            this.Sh_Size = new ELFElement(this.FA, curOff, elemSize);
            curOff += elemSize;

            this.Sh_Link = new ELFElement(this.FA, curOff, 4);
            curOff += 4;
            this.Sh_Info = new ELFElement(this.FA, curOff, 4);
            curOff += 4;

            this.Sh_Addralign = new ELFElement(this.FA, curOff, elemSize);
            curOff += elemSize;
            this.Sh_Entsize = new ELFElement(this.FA, curOff, elemSize);
            curOff += elemSize;
        }

        public getName(): string
        {
            return this.Sh_Name.description();
        }

        private getDescription_Type(): string
        {
            if (this.elfFile.elfCompactMode)
            {
                switch (this.Sh_Type.value)
                {
                    case ELFSectionHeaderTable.SHT_NULL: return "SHT_NULL"; break;
                    case ELFSectionHeaderTable.SHT_PROGBITS: return "SHT_PROGBITS"; break;
                    case ELFSectionHeaderTable.SHT_SYMTAB: return "SHT_SYMTAB"; break;
                    case ELFSectionHeaderTable.SHT_STRTAB: return "SHT_STRTAB"; break;
                    case ELFSectionHeaderTable.SHT_RELA: return "SHT_RELA"; break;
                    case ELFSectionHeaderTable.SHT_HASH: return "SHT_HASH"; break;
                    case ELFSectionHeaderTable.SHT_DYNAMIC: return "SHT_DYNAMIC"; break;
                    case ELFSectionHeaderTable.SHT_NOTE: return "SHT_NOTE"; break;
                    case ELFSectionHeaderTable.SHT_NOBITS: return "SHT_NOBITS"; break;
                    case ELFSectionHeaderTable.SHT_REL: return "SHT_REL"; break;
                    case ELFSectionHeaderTable.SHT_SHLIB: return "SHT_SHLIB"; break;
                    case ELFSectionHeaderTable.SHT_DYNSYM: return "SHT_DYNSYM"; break;
                    case ELFSectionHeaderTable.SHT_INIT_ARRAY: return "SHT_INIT_ARRAY"; break;
                    case ELFSectionHeaderTable.SHT_FINI_ARRAY: return "SHT_FINI_ARRAY"; break;
                    case ELFSectionHeaderTable.SHT_PREINIT_ARRAY: return "SHT_PREINIT_ARRAY"; break;
                    case ELFSectionHeaderTable.SHT_GROUP: return "SHT_GROUP"; break;
                    case ELFSectionHeaderTable.SHT_SYMTAB_SHNDX: return "SHT_SYMTAB_SHNDX"; break;
                    default: return "Unknown"; break;
                }
            }
            else
            {
                switch (this.Sh_Type.value)
                {
                    case ELFSectionHeaderTable.SHT_NULL: return "SHT_NULL (Unused section header)"; break;
                    case ELFSectionHeaderTable.SHT_PROGBITS: return "SHT_PROGBITS (Defined by program)"; break;
                    case ELFSectionHeaderTable.SHT_SYMTAB: return "SHT_SYMTAB (Linker symbol table)"; break;
                    case ELFSectionHeaderTable.SHT_STRTAB: return "SHT_STRTAB (String table)"; break;
                    case ELFSectionHeaderTable.SHT_RELA: return "SHT_RELA (Relocation table)"; break;
                    case ELFSectionHeaderTable.SHT_HASH: return "SHT_HASH (Symbol hash table)"; break;
                    case ELFSectionHeaderTable.SHT_DYNAMIC: return "SHT_DYNAMIC (Dynamic linking table)"; break;
                    case ELFSectionHeaderTable.SHT_NOTE: return "SHT_NOTE (Note information)"; break;
                    case ELFSectionHeaderTable.SHT_NOBITS: return "SHT_NOBITS (Uninitialized space)"; break;
                    case ELFSectionHeaderTable.SHT_REL: return "SHT_REL (Relocation table)"; break;
                    case ELFSectionHeaderTable.SHT_SHLIB: return "SHT_SHLIB (Reserved table)"; break;
                    case ELFSectionHeaderTable.SHT_DYNSYM: return "SHT_DYNSYM (Dynamic loader symbol table)"; break;
                    case ELFSectionHeaderTable.SHT_INIT_ARRAY: return "SHT_INIT_ARRAY (Array of pointers to initialization functions table)"; break;
                    case ELFSectionHeaderTable.SHT_FINI_ARRAY: return "SHT_FINI_ARRAY (Array of pointers to termination functions table)"; break;
                    case ELFSectionHeaderTable.SHT_PREINIT_ARRAY: return "SHT_PREINIT_ARRAY (Array of pointers to pre-initialization functions table)"; break;
                    case ELFSectionHeaderTable.SHT_GROUP: return "SHT_GROUP (Section Group)"; break;
                    case ELFSectionHeaderTable.SHT_SYMTAB_SHNDX: return "SHT_SYMTAB_SHNDX (Extended section indices)"; break;
                    default: return "Unknown"; break;
                }
            }
        }

        private getDescription_Flags(): string
        {
            let s: string = "";
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_W) != 0)
            {
                s += "Write";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_ALLOC) != 0)
            {
                if (s.length > 0) s += "|";
                s += "Alloc";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_EXECINSTR) != 0)
            {
                if (s.length > 0) s += "|";
                s += "Exec";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_MERGE) != 0)
            {
                if (s.length > 0) s += "|";
                s += "Merge";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_STRINGS) != 0)
            {
                if (s.length > 0) s += "|";
                s += "Strings";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_INFO_LINK) != 0)
            {
                if (s.length > 0) s += "|";
                s += "InfoLink";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_LINK_ORDER) != 0)
            {
                if (s.length > 0) s += "|";
                s += "LinkOrder";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_OS_NONCONFORMING) != 0)
            {
                if (s.length > 0) s += "|";
                s += "OS";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_GROUP) != 0)
            {
                if (s.length > 0) s += "|";
                s += "GROUP";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_TLS) != 0)
            {
                if (s.length > 0) s += "|";
                s += "TLS";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_AMD64_LARGE) != 0)
            {
                if (s.length > 0) s += "|";
                s += "Large";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_ORDERED) != 0)
            {
                if (s.length > 0) s += "|";
                s += "Ordered";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_EXCLUDE) != 0)
            {
                if (s.length > 0) s += "|";
                s += "Excluded";
            }
            if ((this.Sh_Flags.value & ELFSectionHeaderTable.SHF_MASKPROC) != 0)
            {
                if (s.length > 0) s += "|";
                s += "Processor-specific";
            }
            return s;
        }

        private getDescription_Name(): string
        {
            let secNameSectionIdx: number;

            secNameSectionIdx = this.elfFile.elfHeader.E_Shstrndx.value;
            if (secNameSectionIdx != 0)
            {
                /* get section containing section names */
                let strSec: ELFSectionHeaderTable = this.elfFile.elfSectionHeaderTables[secNameSectionIdx];
                /* get file offset where section name starts */
                let strStartOffset: number = strSec.Sh_Offset.Get32BitValue() + this.Sh_Name.Get32BitValue();
                /* specify theoretical upper bound for length in case of errors */
                let strMaxLength: number = strSec.Sh_Offset.Get32BitValue() + strSec.Sh_Size.Get32BitValue() - strStartOffset;

                /* read actual string */
                let str: string = "";
                str = this.FA.ReadByteString(strStartOffset, strMaxLength);
                return str;
            }
            else
            {
                return "";
            }
        }
    }

    /**
     * ELF program header table
     */
    export class ELFProgramHeaderTable
    {
        private FA: ELFFileAccess;
        public headerIndex: number;
        private elfFile: ELFFile;

        public P_Type!: ELFElement;
        public P_Flags!: ELFElement;
        public P_Offset!: ELFElement;
        public P_VAddr!: ELFElement;
        public P_PAddr!: ELFElement;
        public P_FileSz!: ELFElement;
        public P_MemSz!: ELFElement;
        public P_Align!: ELFElement;

        constructor(elfFile: ELFFile, headerIndex: number, fileAccess: ELFFileAccess)
        {
            this.FA = fileAccess;
            this.headerIndex = headerIndex;
            this.elfFile = elfFile;
        }

        public load(startAddress: number, elfHeader: ELFHeader): void
        {
            let curOff: number = startAddress;
            let elemSize: number = elfHeader.isELF64() ? 8 : 4;

            if (elfHeader.isELF64())
            {
                this.P_Type = new ELFElement(this.FA, curOff, 4);
                this.P_Type.description = () => { return this.getDescription_PType() };
                curOff += 4;

                this.P_Flags = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
                this.P_Flags.description = () => { return this.getDescription_PFlags() };

                this.P_Offset = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
                this.P_VAddr = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
                this.P_PAddr = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
                this.P_FileSz = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
                this.P_MemSz = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
                this.P_Align = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
            }
            else
            {
                this.P_Type = new ELFElement(this.FA, curOff, 4);
                this.P_Type.description = () => { return this.getDescription_PType() };
                curOff += 4;

                this.P_Offset = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
                this.P_VAddr = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
                this.P_PAddr = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
                this.P_FileSz = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
                this.P_MemSz = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;

                this.P_Flags = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
                this.P_Flags.description = () => { return this.getDescription_PFlags() };

                this.P_Align = new ELFElement(this.FA, curOff, elemSize);
                curOff += elemSize;
            }
        }

        private getDescription_PType(): string
        {
            if (this.elfFile.elfCompactMode)
            {
                switch (this.P_Type.value)
                {
                    case 0: return "PT_NULL"; break;
                    case 1: return "PT_LOAD"; break;
                    case 2: return "PT_DYNAMIC"; break;
                    case 3: return "PT_INTERP"; break;
                    case 4: return "PT_NOTE"; break;
                    case 5: return "PT_SHLIB"; break;
                    case 6: return "PT_PHDR"; break;
                    case 7: return "PT_TLS"; break;
                    case 0x60000000: return "PT_LOOS"; break;
                    case 0x6FFFFFFF: return "PT_HIOS"; break;
                    case 0x70000000: return "PT_LOPROC"; break;
                    case 0x7FFFFFFF: return "PT_HIPROC"; break;
                    default: return "Unknown"; break;
                }
            }
            else
            {
                switch (this.P_Type.value)
                {
                    case 0: return "PT_NULL (Unused entry)"; break;
                    case 1: return "PT_LOAD (Loadable segment)"; break;
                    case 2: return "PT_DYNAMIC (Dynamic linking tables)"; break;
                    case 3: return "PT_INTERP (Program interpreter path name)"; break;
                    case 4: return "PT_NOTE (Note sections)"; break;
                    case 5: return "PT_SHLIB (Reserved)"; break;
                    case 6: return "PT_PHDR (Program header table)"; break;
                    case 7: return "PT_TLS (Thread-local storage)"; break;
                    case 0x60000000: return "PT_LOOS (Environment-speciﬁc use)"; break;
                    case 0x6FFFFFFF: return "PT_HIOS"; break;
                    case 0x70000000: return "PT_LOPROC (Processor-speciﬁc use)"; break;
                    case 0x7FFFFFFF: return "PT_HIPROC"; break;
                    default: return "Unknown"; break;
                }
            }
        }

        private getDescription_PFlags(): string
        {
            let PF_X: number = 0x01; /* Execute permission */
            let PF_W: number = 0x02; /* Write permission */
            let PF_R: number = 0x04; /* Read permission */
            let PF_MASKOS: number = 0x00FF0000; /* Environment-speciﬁc use */
            let PF_MASKPROC: number = 0xFF000000; /* Environment-speciﬁc use */

            let s: string = "";
            if ((this.P_Flags.value == PF_MASKOS) || (this.P_Flags.value == PF_MASKPROC))
            {
                s = "Environment-speciﬁc use";
            }
            else
            {
                if ((this.P_Flags.value & PF_X) != 0)
                {
                    s += "Execute";
                }
                if ((this.P_Flags.value & PF_W) != 0)
                {
                    if (s.length > 0) s += "|";
                    s += "Write";
                }
                if ((this.P_Flags.value & PF_R) != 0)
                {
                    if (s.length > 0) s += "|";
                    s += "Read";
                }
            }
            return s;
        }
    }

    /**
     * One entry of ELF symbol table.
     */
    export class ELFSymbolTableEntry
    {
        private index: number;
        private symTable: ELFSymbolTable;
        private elfFile: ELFFile;
        private FA: ELFFileAccess;

        public St_name!: ELFElement;
        public St_info!: ELFElement;
        public St_other!: ELFElement;
        public St_shndx!: ELFElement;
        public St_value!: ELFElement;
        public St_size!: ELFElement;

        public static STV_DEFAULT: number = 0;
        public static STV_INTERNAL: number = 1;
        public static STV_HIDDEN: number = 2;
        public static STV_PROTECTED: number = 3;
        public static STV_EXPORTED: number = 4;
        public static STV_SINGLETON: number = 5;
        public static STV_ELIMINATE: number = 6;

        public static STB_LOCAL: number = 0;
        public static STB_GLOBAL: number = 1;
        public static STB_WEAK: number = 2;
        public static STB_LOOS: number = 10;
        public static STB_HIOS: number = 12;
        public static STB_LOPROC: number = 13;
        public static STB_HIPROC: number = 15;

        public static STT_NOTYPE: number = 0;
        public static STT_OBJECT: number = 1;
        public static STT_FUNC: number = 2;
        public static STT_SECTION: number = 3;
        public static STT_FILE: number = 4;
        public static STT_COMMON: number = 5;
        public static STT_TLS: number = 6;
        public static STT_LOOS: number = 10;
        public static STT_HIOS: number = 12;
        public static STT_LOPROC: number = 13;
        public static STT_HIPROC: number = 15;

        constructor(index: number, symTable: ELFSymbolTable, elfFile: ELFFile)
        {
            this.index = index;
            this.symTable = symTable;
            this.elfFile = elfFile;
            this.FA = elfFile.elfFileAccess;
        }

        public load(startAddress: number): void
        {
            let curOff: number = startAddress;

            if (this.elfFile.elfHeader.isELF64())
            {
                this.St_name = new ELFElement(this.FA, curOff, 4);
                curOff += 4;

                this.St_info = new ELFElement(this.FA, curOff, 1);
                curOff += 1;
                this.St_other = new ELFElement(this.FA, curOff, 1);
                curOff += 1;

                this.St_shndx = new ELFElement(this.FA, curOff, 2);
                curOff += 2;

                this.St_value = new ELFElement(this.FA, curOff, 8);
                curOff += 8;
                this.St_size = new ELFElement(this.FA, curOff, 8);
                curOff += 8;
            }
            else
            {
                this.St_name = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
                this.St_value = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
                this.St_size = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
                this.St_info = new ELFElement(this.FA, curOff, 1);
                curOff += 1;
                this.St_other = new ELFElement(this.FA, curOff, 1);
                curOff += 1;
                this.St_shndx = new ELFElement(this.FA, curOff, 2);
                curOff += 2;
            }

            this.St_other.description = () => { return this.getDescription_StOther() };
            this.St_info.description = () => { return this.getDescription_StInfo() };
            this.St_name.description = () => { return this.getDescription_StName() };
        }

        private getDescription_StOther(): string
        {
            if (this.elfFile.elfCompactMode)
            {
                switch (this.St_other.Get32BitValue() & 0x03)
                {
                    case ELFSymbolTableEntry.STV_DEFAULT: return "DEFAULT"; break;
                    case ELFSymbolTableEntry.STV_INTERNAL: return "INTERNAL:"; break;
                    case ELFSymbolTableEntry.STV_HIDDEN: return "HIDDEN"; break;
                    case ELFSymbolTableEntry.STV_PROTECTED: return "PROTECTED"; break;
                    case ELFSymbolTableEntry.STV_EXPORTED: return "EXPORTED"; break;
                    case ELFSymbolTableEntry.STV_SINGLETON: return "SINGLETON"; break;
                    case ELFSymbolTableEntry.STV_ELIMINATE: return "ELIMINATE:"; break;
                    default: return "unknown"; break;
                }
            }
            else
            {
                switch (this.St_other.Get32BitValue() & 0x03)
                {
                    case ELFSymbolTableEntry.STV_DEFAULT: return "Visibiility: DEFAULT"; break;
                    case ELFSymbolTableEntry.STV_INTERNAL: return "Visibiility: INTERNAL:"; break;
                    case ELFSymbolTableEntry.STV_HIDDEN: return "Visibiility: HIDDEN"; break;
                    case ELFSymbolTableEntry.STV_PROTECTED: return "Visibiility: PROTECTED"; break;
                    case ELFSymbolTableEntry.STV_EXPORTED: return "Visibiility: EXPORTED"; break;
                    case ELFSymbolTableEntry.STV_SINGLETON: return "Visibiility: SINGLETON"; break;
                    case ELFSymbolTableEntry.STV_ELIMINATE: return "Visibiility: ELIMINATE:"; break;
                    default: return "Visibiility: unknown"; break;
                }
            }
        }

        private getDescription_StInfo(): string
        {
            let s: string = "";

            if (this.elfFile.elfCompactMode)
            {
                switch (this.St_info.Get32BitValue() >> 4)
                {
                    case ELFSymbolTableEntry.STB_LOCAL: s += "LOCAL "; break
                    case ELFSymbolTableEntry.STB_GLOBAL: s += "GLOBAL "; break
                    case ELFSymbolTableEntry.STB_WEAK: s += "WEAK "; break
                    case ELFSymbolTableEntry.STB_LOOS: s += "LOOS "; break
                    case ELFSymbolTableEntry.STB_HIOS: s += "HIOS "; break
                    case ELFSymbolTableEntry.STB_LOPROC: s += "LOPROC "; break
                    case ELFSymbolTableEntry.STB_HIPROC: s += "HIPROC "; break
                    default: s += "Unknown "; break
                }

                switch (this.St_info.Get32BitValue() & 0x0F)
                {
                    case ELFSymbolTableEntry.STT_NOTYPE: s += "| NOTYPE"; break
                    case ELFSymbolTableEntry.STT_OBJECT: s += "| OBJECT"; break
                    case ELFSymbolTableEntry.STT_FUNC: s += "| FUNC"; break
                    case ELFSymbolTableEntry.STT_SECTION: s += "| SECTION"; break
                    case ELFSymbolTableEntry.STT_FILE: s += "| FILE"; break
                    case ELFSymbolTableEntry.STT_COMMON: s += "| COMMON"; break
                    case ELFSymbolTableEntry.STT_TLS: s += "| TLS"; break
                    case ELFSymbolTableEntry.STT_LOOS: s += "| LOOS"; break
                    case ELFSymbolTableEntry.STT_HIOS: s += "| HIOS"; break
                    case ELFSymbolTableEntry.STT_LOPROC: s += "| LOPROC"; break
                    case ELFSymbolTableEntry.STT_HIPROC: s += "| HIPROC"; break
                    default: s += "| Unknown "; break
                }
            }
            else
            {
                switch (this.St_info.Get32BitValue() >> 4)
                {
                    case ELFSymbolTableEntry.STB_LOCAL: s += "Binding: LOCAL "; break
                    case ELFSymbolTableEntry.STB_GLOBAL: s += "Binding: GLOBAL "; break
                    case ELFSymbolTableEntry.STB_WEAK: s += "Binding: WEAK "; break
                    case ELFSymbolTableEntry.STB_LOOS: s += "Binding: LOOS "; break
                    case ELFSymbolTableEntry.STB_HIOS: s += "Binding: HIOS "; break
                    case ELFSymbolTableEntry.STB_LOPROC: s += "Binding: LOPROC "; break
                    case ELFSymbolTableEntry.STB_HIPROC: s += "Binding: HIPROC "; break
                    default: s += "Binding: Unknown "; break
                }

                switch (this.St_info.Get32BitValue() & 0x0F)
                {
                    case ELFSymbolTableEntry.STT_NOTYPE: s += "| Type: NOTYPE"; break
                    case ELFSymbolTableEntry.STT_OBJECT: s += "| Type: OBJECT"; break
                    case ELFSymbolTableEntry.STT_FUNC: s += "| Type: FUNC"; break
                    case ELFSymbolTableEntry.STT_SECTION: s += "| Type: SECTION"; break
                    case ELFSymbolTableEntry.STT_FILE: s += "| Type: FILE"; break
                    case ELFSymbolTableEntry.STT_COMMON: s += "| Type: COMMON"; break
                    case ELFSymbolTableEntry.STT_TLS: s += "| Type: TLS"; break
                    case ELFSymbolTableEntry.STT_LOOS: s += "| Type: LOOS"; break
                    case ELFSymbolTableEntry.STT_HIOS: s += "| Type: HIOS"; break
                    case ELFSymbolTableEntry.STT_LOPROC: s += "| Type: LOPROC"; break
                    case ELFSymbolTableEntry.STT_HIPROC: s += "| Type: HIPROC"; break
                    default: s += "Type: Unknown "; break
                }
            }

            return s;
        }

        private getDescription_StName(): string
        {
            let str: string = "";
            if (this.St_name.Get32BitValue() != 0)
            {
                let symStrTableIdx: number = this.symTable.getRefSectionTable().Sh_Link.Get32BitValue();
                if (symStrTableIdx < this.elfFile.getNumOfSectionHeaderTables())
                {
                    /* file offset of beginning of section of symbol names */
                    let symStringTableFileOffset: number = this.elfFile.elfSectionHeaderTables[symStrTableIdx].Sh_Offset.Get32BitValue();
                    /* file offset to beginning of symbol name string */
                    let secNameStringFileOffset: number = symStringTableFileOffset + this.St_name.Get32BitValue();
                    /* specify theoretical upper bound for length in case of errors */
                    let strMaxLength: number = symStringTableFileOffset + this.elfFile.elfSectionHeaderTables[symStrTableIdx].Sh_Size.Get32BitValue() - secNameStringFileOffset;

                    /* read actual string */
                    str = this.FA.ReadByteString(secNameStringFileOffset, strMaxLength);
                    return str;
                }
            }
            return str;
        }
    }

    /**
     * ELF symbol table
     */
    export class ELFSymbolTable
    {
        private sectionTable: ELFSectionHeaderTable;
        private FA: ELFFileAccess;
        private elffile: ELFFile;

        public symTabEntries: Array<ELFSymbolTableEntry> = [];

        constructor(sectionTable: ELFSectionHeaderTable, fileAccess: ELFFileAccess, elffile: ELFFile)
        {
            this.FA = fileAccess;
            this.sectionTable = sectionTable;
            this.elffile = elffile;
        }

        public load(): void
        {
            let numOfEntrys: number = (this.sectionTable.Sh_Size.Get32BitValue() / this.sectionTable.Sh_Entsize.Get32BitValue());
            for (let i: number = 0; i < numOfEntrys; i++)
            {
                let symEntry: ELFSymbolTableEntry = new ELFSymbolTableEntry(i, this, this.elffile);
                symEntry.load(this.sectionTable.Sh_Offset.Get32BitValue() + (i * this.sectionTable.Sh_Entsize.Get32BitValue()));
                this.symTabEntries.push(symEntry);
            }
        }

        public getNumOfEntries(): number
        {
            return this.symTabEntries.length;
        }

        public getRefSectionTable(): ELFSectionHeaderTable
        {
            return this.sectionTable;
        }
    }

    /**
     * One entry inside a ELF note table
     */
    export class ELFNoteTableEntry
    {
        public NameElement: ELFElement;
        public DescElement: ELFElement;
        public Type: ELFElement;

        private noteName: string;
        private noteDesc: number[];

        constructor(nameElement: ELFElement, noteName: string, type: ELFElement, descElement: ELFElement, noteDesc: number[])
        {
            this.NameElement = nameElement;
            this.noteName = noteName;
            this.Type = type;
            this.noteDesc = noteDesc;
            this.DescElement = descElement;

            this.NameElement.description = () => { return this.getName(); }
        }

        public getName(): string
        {
            return this.noteName;
        }

        public getDesc(): number[]
        {
            return this.noteDesc;
        }
    }

    /**
     * ELF note table
     */
    export class ELFNoteTable
    {
        private sectionTable: ELFSectionHeaderTable;
        private FA: ELFFileAccess;
        private elfFile: ELFFile;

        public noteTabEntries!: ELFNoteTableEntry[];

        constructor(sectionTable: ELFSectionHeaderTable, fileAccess: ELFFileAccess, elfFile: ELFFile)
        {
            this.FA = fileAccess;
            this.sectionTable = sectionTable;
            this.elfFile = elfFile;
        }

        public load(): ELFFileLoadResult
        {
            this.noteTabEntries = [];
            let result: ELFFileLoadResult = ELFFileLoadResult.OK;

            let curOff: number = this.sectionTable.Sh_Offset.Get32BitValue();
            while (curOff + 0x18 <= this.sectionTable.Sh_Offset.Get32BitValue() + this.sectionTable.Sh_Size.Get32BitValue() )
            {
                let namesz: ELFElement = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
                let descsz: ELFElement = new ELFElement(this.FA, curOff, 4);
                curOff += 4;
                let type: ELFElement = new ELFElement(this.FA, curOff, 4);
                curOff += 4;

                let noteName: string = "";
                if (namesz.Get32BitValue() > 0)
                {
                    if (curOff + namesz.Get32BitValue() > this.FA.getDataView().byteLength)
                    {
                        result = ELFFileLoadResult.INVALID_ELF;
                        break;
                    }

                    noteName = this.FA.ReadByteString(curOff, namesz.Get32BitValue());
                    curOff += namesz.Get32BitValue();
                    let namePaddingVal: number = namesz.Get32BitValue();
                    while ((namePaddingVal & 0x03) != 0)
                    {
                        curOff++;
                        namePaddingVal++;
                    }
                }

                let noteDesc: number[] = [];
                if (descsz.Get32BitValue() > 0)
                {
                    for (let i = 0; i < descsz.Get32BitValue(); i++)
                    {
                        if (curOff > this.FA.getDataView().byteLength)
                        {
                            result = ELFFileLoadResult.INVALID_ELF;
                            break;
                        }
                        noteDesc.push(this.FA.getDataView().getUint8(curOff));
                        curOff++;
                    }
                    let descPaddingVal: number = descsz.Get32BitValue();
                    while ((descPaddingVal & 0x03) != 0)
                    {
                        curOff++;
                        descPaddingVal++;
                    }
                }

                this.noteTabEntries.push(new ELFNoteTableEntry(namesz, noteName, type, descsz, noteDesc));
            }

            return result;
        }

        public getNumOfEntries(): number
        {
            return this.noteTabEntries.length;
        }

        public getRefSectionTable(): ELFSectionHeaderTable
        {
            return this.sectionTable;
        }
    }

    /**
     * Main class to load and access the contents of a ELF file.
     */
    export class ELFFile
    {
        public elfFileAccess: ELFFileAccess;
        public elfHeader!: ELFHeader;
        public elfProgramHeaderTables: Array<ELFProgramHeaderTable> = [];
        public elfSectionHeaderTables: Array<ELFSectionHeaderTable> = [];
        public elfSymbolTables: Array<ELFSymbolTable> = [];
        public elfNoteTables: ELFNoteTable[] = [];
        public elfCompactMode: boolean;

        constructor(fileBytes: ArrayBuffer)
        {
            this.elfFileAccess = new ELFFileAccess(fileBytes);
            this.elfCompactMode = false;
        }

        private loadProgramHeaderTables(): ELFFileLoadResult
        {
            /* NOTE: following code only works with 32bit ELF files */
            if (((this.elfHeader.E_PhOff.value == 0) && (this.elfHeader.E_PhOff.value2 == 0)) ||
                ((this.elfHeader.E_PhOff.Get32BitValue() + (this.elfHeader.E_Phnum.Get32BitValue() * this.elfHeader.E_Phentsize.Get32BitValue())) > this.elfFileAccess.getDataView().byteLength))
            {
                return ELFFileLoadResult.INVALID_ELF;
            }

            for (let headerIndex: number = 0; headerIndex < this.elfHeader.E_Phnum.Get32BitValue(); headerIndex++)
            {
                this.elfProgramHeaderTables.push(new ELFProgramHeaderTable(this, headerIndex, this.elfFileAccess));
                this.elfProgramHeaderTables[headerIndex].load(this.elfHeader.E_PhOff.Get32BitValue() + headerIndex * this.elfHeader.E_Phentsize.Get32BitValue(), this.elfHeader);
            }

            return ELFFileLoadResult.OK;
        }

        private loadSectionHeaderTables(): ELFFileLoadResult
        {
            /* NOTE: following code only works with 32bit ELF files */
            if (((this.elfHeader.E_ShOff.value == 0) && (this.elfHeader.E_ShOff.value2 == 0)) ||
                ((this.elfHeader.E_ShOff.Get32BitValue() + (this.elfHeader.E_Shnum.Get32BitValue() * this.elfHeader.E_Shentsize.Get32BitValue())) > this.elfFileAccess.getDataView().byteLength))
            {
                return ELFFileLoadResult.INVALID_ELF;
            }

            for (let headerIndex: number = 0; headerIndex < this.elfHeader.E_Shnum.Get32BitValue(); headerIndex++)
            {
                this.elfSectionHeaderTables.push(new ELFSectionHeaderTable(headerIndex, this.elfFileAccess, this));
                this.elfSectionHeaderTables[headerIndex].load(this.elfHeader.E_ShOff.Get32BitValue() + headerIndex * this.elfHeader.E_Shentsize.Get32BitValue());
            }

            return ELFFileLoadResult.OK;
        }

        private loadSymbolTables(): ELFFileLoadResult
        {
            for (let secIdx: number = 0; secIdx < this.getNumOfSectionHeaderTables(); secIdx++)
            {
                if ((this.elfSectionHeaderTables[secIdx].Sh_Type.Get32BitValue() == ELFSectionHeaderTable.SHT_SYMTAB) ||
                    (this.elfSectionHeaderTables[secIdx].Sh_Type.Get32BitValue() == ELFSectionHeaderTable.SHT_DYNSYM))
                {
                    let symTab: ELFSymbolTable = new ELFSymbolTable(this.elfSectionHeaderTables[secIdx], this.elfFileAccess, this);
                    symTab.load();
                    this.elfSymbolTables.push(symTab);
                }
            }

            return ELFFileLoadResult.OK;
        }

        private loadNoteTables(): ELFFileLoadResult
        {
            let result: ELFFileLoadResult = ELFFileLoadResult.OK;
            for (let secIdx: number = 0; secIdx < this.getNumOfSectionHeaderTables(); secIdx++)
            {
                if (this.elfSectionHeaderTables[secIdx].Sh_Type.Get32BitValue() == ELFSectionHeaderTable.SHT_NOTE)
                {
                    let noteTab: ELFNoteTable = new ELFNoteTable(this.elfSectionHeaderTables[secIdx], this.elfFileAccess, this);
                    result = noteTab.load();
                    if (result != ELFFileLoadResult.OK)
                    {
                        break;
                    }
                    this.elfNoteTables.push(noteTab);
                }
            }

            return result;
        }

        public getNumOfProgramHeaderTables(): number
        {
            return this.elfHeader.E_Phnum.Get32BitValue();
        }

        public getNumOfSectionHeaderTables(): number
        {
            return this.elfHeader.E_Shnum.Get32BitValue();
        }

        public getNumOfSymbolTables(): number
        {
            return this.elfSymbolTables.length;
        }

        public getNumOfNoteTables(): number
        {
            return this.elfNoteTables.length;
        }

        public load(): ELFFileLoadResult
        {
            this.elfHeader = new ELFHeader(this.elfFileAccess);
            let result: ELFFileLoadResult;

            result = this.elfHeader.load();
            if (result == ELFFileLoadResult.OK)
            {
                result = this.loadProgramHeaderTables();
            }

            if (result == ELFFileLoadResult.OK)
            {
                result = this.loadSectionHeaderTables();
            }

            if (result == ELFFileLoadResult.OK)
            {
                result = this.loadSymbolTables();
            }

            if (result == ELFFileLoadResult.OK)
            {
                result = this.loadNoteTables();
            }

            return result;
        }
    }



