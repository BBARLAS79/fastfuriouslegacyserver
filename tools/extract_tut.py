#!/usr/bin/env python3
"""
Read #Strings and #US streams directly from raw DLL bytes
to find tutorial G3 info and G1->G2 transition
"""
import dnfile, struct, re

dll_path = "/Users/berkeipekci/Documents/New project/ff7_030_managed/Assembly-CSharp.dll"

# Read raw bytes
with open(dll_path, 'rb') as f:
    raw = f.read()

pe = dnfile.dnPE(dll_path)
net = pe.net

# Get the CLI header / metadata offset
# The metadata RVA is stored in the COM descriptor
print("=== STREAM OFFSETS ===")
metadata_rva = None
metadata_offset = None

# Find metadata via dnfile structure
md = net.metadata
md_struct = md.struct
print("md_struct attrs:", [a for a in dir(md_struct) if not a.startswith('_')])
print("md_struct.Offset:", getattr(md_struct, 'Offset', 'N/A'))
print("md_struct.file_offset:", getattr(md_struct, 'file_offset', 'N/A'))
print("md_struct rva:", getattr(md_struct, 'rva', 'N/A'))

# Try to find #Strings via raw search in the file
print("\n=== SEARCHING RAW BYTES FOR STREAM HEADERS ===")
# Look for stream header signatures
for marker in [b'#Strings', b'#US', b'#GUID', b'#Blob', b'#~']:
    pos = raw.find(marker)
    if pos != -1:
        print(f"  Found {marker} at offset 0x{pos:x}")

# Actually let's just search the whole file for tutorial strings directly
print("\n=== ALL TUTORIAL STRINGS IN RAW DLL ===")
# UTF-8 / ASCII strings
ascii_strs = set()
for m in re.finditer(rb'[\x20-\x7e]{4,}', raw):
    s = m.group().decode('ascii', errors='replace')
    sl = s.lower()
    if any(k in sl for k in ['tutorial', 'chapter_00', 'chapter_01', 'g1', 'g2', 'g3',
                               'fte', 'nextgroup', 'nextbranch', 'completebranch',
                               'runsequential', 'runnext', 'getaway', 'sequence_tutorial',
                               'jumptorace', 'tutorialgroup', 'menu']):
        if s not in ascii_strs and len(s) < 200:
            ascii_strs.add(s)

for s in sorted(ascii_strs):
    print(f"  ASCII: {repr(s)}")

# UTF-16LE strings  
print("\n=== UTF-16LE STRINGS ===")
utf16_strs = set()
for m in re.finditer(rb'(?:[\x20-\x7e]\x00){4,}', raw):
    try:
        s = m.group().decode('utf-16-le', errors='replace')
        sl = s.lower()
        if any(k in sl for k in ['tutorial', 'chapter_00', 'chapter_01',
                                   'fte', 'nextgroup', 'nextbranch', 'getaway',
                                   'sequence_tutorial', 'jumptorace', 'g1', 'g2', 'g3']):
            if s not in utf16_strs and len(s) < 200:
                utf16_strs.add(s)
    except:
        pass

for s in sorted(utf16_strs):
    print(f"  UTF16: {repr(s)}")

print("\nDone.")
