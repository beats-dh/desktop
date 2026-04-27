#!/bin/sh

git config --global --add safe.directory /github/workspace
# Tests create throwaway repos under /tmp owned by a different uid than the
# container user; git 2.35+ refuses to operate on them without this exception.
git config --global --add safe.directory '*'

yarn
yarn run postinstall
yarn build:prod
yarn run package

yarn test:setup
yarn test:unit
yarn test:script
