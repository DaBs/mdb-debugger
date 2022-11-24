declare module 'elf-tools' {

    export type ELFClass = 'none' | '32' | '64';
    export type ELFEndianness = 'none' | 'lsb' | 'msb';
    export type ELFABIVersion = 'none' | 'current';
    export type ELFType = 'none' | 'rel' | 'exec' | 'dyn' | 'core';

    export type ELFEntryType = 'null' | 'load' | 'dynamic' | 'interp' | 'note' | 'shlib' | 'phdr' | 'tls';

    export type ELFSectorType = 'null' |
        'progbits' | 'symtab' | 'strtab' |
        'rela' | 'hash' | 'dynamic' | 'note' |
        'nobits' | 'rel' | 'shlib' | 'dynsym' |
        'unknown12' | 'unknown13' | 'init_array' |
        'fini_array' | 'preinit_array' | 'group' |
        'symtab_shndx';

    export type ELFHeader = {
        abiversion: ELFABIVersion;
        class: ELFClass;
        ehsize: number;
        elfsig: Buffer;
        endian: ELFEndianness;
        entry: number;
        flags: number;
        machine: string;
        osabi: string;
        padding: Buffer;
        phentsize: number;
        phnum: number;
        phoff: number;
        shentsize: number;
        shnum: number;
        shoff: number;
        shstrndx: number;
        type: ELFType;
        version: number;
    }

    export type ELFProgramHeader = {
        align: number;
        filesz: number;
        flags: string;
        memsz: number;
        offset: number;
        paddr: number;
        type: ELFEntryType;
        vaddr: number;
    }

    export type ELFProgram = {
        data: Buffer;
        header: ELFProgramHeader;
    }

    export type ELFSectionHeader = {
        addr: number;
        addralign: number;
        entsize: number;
        flags: string;
        info: number;
        link: number;
        name: string;
        offset: number;
        size: number;
        type: ELFSectorType;
    }

    export type ELFSection = {
        data: Buffer;
        header: ELFSectionHeader;
    }

    export type ELFStringTable = {
        section_header: ELFSectionHeader;
        strings: string;
    }

    export interface ELFFile {
        header: ELFHeader;
        programs: ELFProgram[];
        sections: ELFSection[];
        sh_string_table: ELFStringTable;
    }

    export function parse(buffer: Buffer): ELFFile;
}