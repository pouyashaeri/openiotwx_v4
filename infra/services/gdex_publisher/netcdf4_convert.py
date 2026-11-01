#!/usr/bin/env python3
"""
Turn a release's NetCDF-3 file into NetCDF-4 with compression and chunking.

The app writes NetCDF-3 classic because it has no dependencies and every tool reads it. GDEX also
accepts (and for large archives prefers) NetCDF-4/HDF5, which compresses well and reads quickly in
slices. Same variables, same attributes, same values; only the storage changes.

    python netcdf4_convert.py openiotwx-network_2026-10.nc [out.nc] [--level 4] [--chunk 65536]

Chunks run along the observation dimension (one time series per read is the common access
pattern). Data variables use shuffle + zlib. Then it re-reads both files and checks every value.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

import netCDF4
import numpy as np


def convert(src: Path, dst: Path, level: int, chunk: int) -> None:
    with netCDF4.Dataset(src) as a, netCDF4.Dataset(dst, "w", format="NETCDF4") as b:
        for k in a.ncattrs():
            b.setncattr(k, a.getncattr(k))
        for name, dim in a.dimensions.items():
            b.createDimension(name, len(dim))
        for name, v in a.variables.items():
            fill = v.getncattr("_FillValue") if "_FillValue" in v.ncattrs() else None
            numeric = v.dtype.kind in "fi" and v.ndim >= 1 and v.shape[0] > 1
            kwargs = {}
            if numeric:
                kwargs.update(zlib=True, complevel=level, shuffle=True)
                if v.ndim == 1 and v.dimensions[0] == "obs":
                    kwargs["chunksizes"] = (max(1, min(chunk, v.shape[0])),)
            out = b.createVariable(name, v.dtype, v.dimensions, fill_value=fill, **kwargs)
            for k in v.ncattrs():
                if k != "_FillValue":
                    out.setncattr(k, v.getncattr(k))
            out.set_auto_maskandscale(False)
            v.set_auto_maskandscale(False)
            out[:] = v[:]
        b.setncattr("history", f"{a.getncattr('history') if 'history' in a.ncattrs() else ''} | converted to NetCDF-4 (zlib {level}, chunks along obs) by netcdf4_convert.py".strip(" |"))


def same(src: Path, dst: Path) -> list[str]:
    bad: list[str] = []
    with netCDF4.Dataset(src) as a, netCDF4.Dataset(dst) as b:
        if set(a.variables) != set(b.variables):
            bad.append("the files do not have the same variables")
        for name, v in a.variables.items():
            v.set_auto_maskandscale(False)
            b.variables[name].set_auto_maskandscale(False)
            x, y = v[:], b.variables[name][:]
            if v.dtype.kind in "fi":
                if not np.array_equal(np.asarray(x), np.asarray(y)):
                    bad.append(f"values differ in {name}")
            elif not np.array_equal(np.asarray(x), np.asarray(y)):
                bad.append(f"text differs in {name}")
            for k in v.ncattrs():
                if k != "_FillValue" and str(v.getncattr(k)) != str(b.variables[name].getncattr(k)):
                    bad.append(f"attribute {k} differs on {name}")
    return bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path, nargs="?")
    ap.add_argument("--level", type=int, default=4)
    ap.add_argument("--chunk", type=int, default=65536)
    args = ap.parse_args()
    dst = args.dst or args.src.with_name(args.src.stem + "_nc4.nc")
    convert(args.src, dst, args.level, args.chunk)
    problems = same(args.src, dst)
    sha = hashlib.sha256(dst.read_bytes()).hexdigest()
    print(f"{dst}  {dst.stat().st_size} bytes (was {args.src.stat().st_size})  sha256 {sha}")
    if problems:
        print("MISMATCH:", *problems, sep="\n  - ")
        return 1
    print("verified: every value and attribute matches the original")
    return 0


if __name__ == "__main__":
    sys.exit(main())
