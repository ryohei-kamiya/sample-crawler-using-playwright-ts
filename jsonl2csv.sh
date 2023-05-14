#!/bin/bash

if [ $# -eq 0 ]; then
  echo "Usage: ./jsonl2csv.sh input.jsonl > output.csv";
  exit 1;
fi

jq -s '.' "$1" | jq  -r '(map(keys) | add | unique) as $cols | map(. as $row | $cols | map($row[.])) as $rows | $cols, $rows[] | @csv'
