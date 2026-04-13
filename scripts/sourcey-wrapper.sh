#!/usr/bin/env bash
set -euo pipefail

resolve_path() {
  local path="$1"
  if [[ "$path" = /* ]]; then
    printf '%s\n' "$path"
    return 0
  fi

  local dir base
  dir="$(dirname "$path")"
  base="$(basename "$path")"
  if [[ "$dir" == "." ]]; then
    printf '%s/%s\n' "$PWD" "$base"
    return 0
  fi

  printf '%s/%s\n' "$(cd "$dir" && pwd -P)" "$base"
}

if [[ "${1:-}" == "build" ]]; then
  args=("$@")
  config_path=""
  normalized=("build")

  i=1
  while [[ $i -lt ${#args[@]} ]]; do
    arg="${args[$i]}"
    case "$arg" in
      --config)
        i=$((i + 1))
        config_path="${args[$i]}"
        ;;
      -o|--output)
        i=$((i + 1))
        output_path="$(resolve_path "${args[$i]}")"
        normalized+=("$arg" "$output_path")
        ;;
      *)
        normalized+=("$arg")
        ;;
    esac
    i=$((i + 1))
  done

  if [[ -n "$config_path" ]]; then
    config_abs="$(resolve_path "$config_path")"
    config_dir="$(dirname "$config_abs")"
    config_file="$(basename "$config_abs")"

    if [[ ! -f "$config_abs" ]]; then
      printf 'sourcey-wrapper: config not found: %s\n' "$config_abs" >&2
      exit 1
    fi

    (
      cd "$config_dir"
      exec npx -y sourcey "${normalized[@]:0:1}" --config "$config_file" "${normalized[@]:1}"
    )
  fi
fi

exec npx -y sourcey "$@"
