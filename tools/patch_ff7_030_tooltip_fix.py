#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

import dnfile
import pefile


MANAGED_REL = "assets/bin/Data/Managed/Assembly-CSharp.dll"


def find_typedef(pe: dnfile.dnPE, type_name: str):
    for index, row in enumerate(pe.net.mdtables.TypeDef.rows, start=1):
        if row.TypeName and row.TypeName.value == type_name:
            return index, row
    raise KeyError(f"type not found: {type_name}")


def find_methoddef(pe: dnfile.dnPE, type_name: str, method_name: str):
    _, td = find_typedef(pe, type_name)
    for idx in td.MethodList:
        row = idx.row
        if row.Name and row.Name.value == method_name:
            return idx.row_index, row
    raise KeyError(f"method not found: {type_name}::{method_name}")


def get_next_rva(pe: dnfile.dnPE, current_rva: int) -> int:
    higher = sorted(row.Rva for row in pe.net.mdtables.MethodDef.rows if row.Rva and row.Rva > current_rva)
    if not higher:
        raise ValueError(f"no method after rva {hex(current_rva)}")
    return higher[0]


def build_nop_ret_body(code_size: int) -> bytes:
    if code_size < 1:
        raise ValueError("code_size must be >= 1")
    return (b"\x00" * (code_size - 1)) + b"\x2A"


def patch_method_to_nop_ret(
    blob: bytearray,
    pe_meta: dnfile.dnPE,
    pe_img: pefile.PE,
    type_name: str,
    method_name: str,
):
    _, method_row = find_methoddef(pe_meta, type_name, method_name)
    rva = method_row.Rva
    next_rva = get_next_rva(pe_meta, rva)
    method_off = pe_img.get_offset_from_rva(rva)
    available = next_rva - rva
    if available < 12:
        raise ValueError(f"{type_name}::{method_name} has invalid slot size {available}")

    header = bytearray(blob[method_off : method_off + 12])
    # Fat header layout: flags/size (2), maxstack (2), code_size (4), local sig token (4)
    code_size = int.from_bytes(header[4:8], "little")
    body_start = method_off + 12
    body_end = body_start + code_size
    if body_end > len(blob):
        raise ValueError(f"{type_name}::{method_name} body exceeds file bounds")

    blob[body_start:body_end] = build_nop_ret_body(code_size)


def patch_dll(src: Path, dst: Path):
    pe_meta = dnfile.dnPE(str(src))
    pe_img = pefile.PE(str(src))
    blob = bytearray(src.read_bytes())

    # This tutorial flow crashes in Generic_ToolTip.PositionTooltip when the
    # sequence-created tooltip resolves to an invalid anchor. Making the sequence
    # tooltip parent lookup return null disables only that unsafe anchoring path.
    patch_method_to_nop_ret(blob, pe_meta, pe_img, "SequenceAction_InGameToolTip", "GetParentGameObject")

    dst.write_bytes(blob)


def rebuild_apk(base_apk: Path, patched_dll: Path, output_apk: Path, keystore: Path, alias: str, storepass: str, keypass: str):
    with tempfile.TemporaryDirectory(prefix="ff7_030_tooltipfix_") as tmpdir:
        tmpdir = Path(tmpdir)
        unsigned_apk = tmpdir / "unsigned.apk"
        aligned_apk = tmpdir / "aligned.apk"
        with zipfile.ZipFile(base_apk, "r") as zin, zipfile.ZipFile(unsigned_apk, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename.upper().startswith("META-INF/"):
                    continue
                data = patched_dll.read_bytes() if item.filename == MANAGED_REL else zin.read(item.filename)
                zout.writestr(item, data)

        zipalign = Path("/Users/berkeipekci/Library/Android/sdk/build-tools/36.1.0/zipalign")
        apksigner = Path("/Users/berkeipekci/Library/Android/sdk/build-tools/36.1.0/apksigner")

        subprocess.run([str(zipalign), "-f", "4", str(unsigned_apk), str(aligned_apk)], check=True)
        subprocess.run(
            [
                str(apksigner),
                "sign",
                "--ks",
                str(keystore),
                "--ks-key-alias",
                alias,
                "--ks-pass",
                f"pass:{storepass}",
                "--key-pass",
                f"pass:{keypass}",
                "--out",
                str(output_apk),
                str(aligned_apk),
            ],
            check=True,
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-apk", type=Path, required=True)
    parser.add_argument("--managed-dll", type=Path, required=True)
    parser.add_argument("--patched-dll", type=Path, required=True)
    parser.add_argument("--output-apk", type=Path, required=True)
    parser.add_argument("--keystore", type=Path, required=True)
    parser.add_argument("--alias", default="androiddebugkey")
    parser.add_argument("--storepass", default="android")
    parser.add_argument("--keypass", default="android")
    args = parser.parse_args()

    patch_dll(args.managed_dll, args.patched_dll)
    rebuild_apk(
        base_apk=args.base_apk,
        patched_dll=args.patched_dll,
        output_apk=args.output_apk,
        keystore=args.keystore,
        alias=args.alias,
        storepass=args.storepass,
        keypass=args.keypass,
    )


if __name__ == "__main__":
    main()
