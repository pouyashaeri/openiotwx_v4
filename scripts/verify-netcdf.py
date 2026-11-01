#!/usr/bin/env python3
"""
Check a GDEX release NetCDF with an independent, standard reader (netCDF4 if installed, else scipy).

    python scripts/verify-netcdf.py openiotwx-network_2026-10.nc

It checks what GDEX asked for (numeric time, coordinates, descriptive metadata) and the CF-1.8 rules
that apply to this layout (a contiguous ragged array of time series). It is not a replacement for the
official CF checker (https://github.com/cedadev/cf-checker); run that too when it is available.

Exit status 0 when every check passes, 1 otherwise.
"""
from __future__ import annotations

import sys

import numpy as np


def open_file(path):
    try:
        import netCDF4  # type: ignore

        ds = netCDF4.Dataset(path)
        dims = {k: len(v) for k, v in ds.dimensions.items()}
        attrs = {k: ds.getncattr(k) for k in ds.ncattrs()}
        var = {}
        for name, v in ds.variables.items():
            a = {k: v.getncattr(k) for k in v.ncattrs()}
            data = v[:]
            data = data.filled(np.nan) if hasattr(data, "filled") and v.dtype.kind == "f" else np.asarray(data)
            var[name] = (v.dimensions, a, data, v.dtype)
        return "netCDF4", dims, attrs, var
    except ImportError:
        from scipy.io import netcdf_file

        f = netcdf_file(path, mmap=False)
        text = lambda x: x.decode() if isinstance(x, bytes) else x  # noqa: E731
        dims = dict(f.dimensions)
        attrs = {k: text(v) for k, v in f._attributes.items()}
        var = {}
        for name, v in f.variables.items():
            a = {k: text(x) for k, x in v._attributes.items()}
            var[name] = (v.dimensions, a, np.array(v.data), v.data.dtype)
        return "scipy", dims, attrs, var


def main(path: str) -> int:
    reader, dims, attrs, var = open_file(path)
    bad: list[str] = []

    def need(cond: bool, msg: str) -> None:
        if not cond:
            bad.append(msg)

    print(f"read with {reader}: {dims['station']} stations, {dims['obs']} observations, {len(var)} variables")

    # Global metadata ("absolutely no descriptive metadata" is exactly what GDEX does not want to see)
    need("CF-1.8" in str(attrs.get("Conventions", "")), "Conventions must name CF-1.8")
    need(attrs.get("featureType") == "timeSeries", "featureType must be timeSeries")
    for g in ("title", "summary", "institution", "license", "creator_name", "creator_email", "history",
              "time_coverage_start", "time_coverage_end", "geospatial_lat_min", "geospatial_lat_max",
              "geospatial_lon_min", "geospatial_lon_max"):
        need(g in attrs and str(attrs[g]) != "", f"missing global attribute {g}")

    # Time is a number with a UDUNITS reference time, never text
    need("time" in var, "no time variable")
    if "time" in var:
        d, a, t, dt = var["time"]
        need(dt.kind in "fi", f"time must be numeric, found dtype {dt}")
        need(str(a.get("units", "")).startswith("seconds since "), "time units must be 'seconds since <date>'")
        need(a.get("standard_name") == "time", "time needs standard_name time")

    # Coordinates
    for name, lo, hi, std, units in (("lat", -90, 90, "latitude", "degrees_north"), ("lon", -180, 180, "longitude", "degrees_east")):
        need(name in var, f"no {name} variable")
        if name in var:
            _, a, x, _ = var[name]
            need(a.get("standard_name") == std and a.get("units") == units, f"{name} needs standard_name {std} and units {units}")
            need(bool(np.all((x >= lo) & (x <= hi))), f"{name} out of range")
    need("alt" in var, "no alt variable")

    # Ragged array structure
    need("row_size" in var and var["row_size"][1].get("sample_dimension") == "obs", "row_size must carry sample_dimension=obs")
    if "row_size" in var and "time" in var:
        sizes = var["row_size"][2].astype(int)
        t = var["time"][2].astype(float)
        need(int(sizes.sum()) == len(t), "row_size must add up to the number of observations")
        at = 0
        for n in sizes:
            seg = t[at : at + n]
            need(bool(np.all(np.diff(seg) > 0)), "time must increase within each station")
            at += n
    need("station_id" in var and var["station_id"][1].get("cf_role") == "timeseries_id", "station_id needs cf_role timeseries_id")

    # Every data variable is described
    structural = {"station_id", "station_name", "lat", "lon", "alt", "row_size", "time"}
    data_vars = [n for n in var if n not in structural]
    need(len(data_vars) > 0, "no data variables")
    for n in data_vars:
        d, a, x, _ = var[n]
        need(d == ("obs",), f"{n} must be on the obs dimension")
        need(bool(a.get("units")), f"{n} has no units")
        need(bool(a.get("long_name")), f"{n} has no long_name")
        need("_FillValue" in a, f"{n} has no _FillValue")
        need(str(a.get("coordinates", "")) == "time lat lon alt", f"{n} coordinates must be 'time lat lon alt'")
        finite = x[np.isfinite(x) & (x < 1e30)]
        if finite.size and "actual_range" in a:
            need(abs(float(a["actual_range"][0]) - float(finite.min())) < 1e-3 * max(1.0, abs(float(finite.min()))), f"{n} actual_range does not match the data")
    print("variables:", ", ".join(f"{n} [{var[n][1].get('units')}]" for n in data_vars))

    if bad:
        print("FAILED:")
        for b in bad:
            print("  -", b)
        return 1
    print("OK: numeric UTC time, coordinates, units and long_name on every variable, CF-1.8 ragged time series")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
