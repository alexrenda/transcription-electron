#!/usr/bin/env bash

curl -L https://github.com/indygreg/python-build-standalone/releases/download/20210724/cpython-3.9.6-x86_64-apple-darwin-install_only-20210724T1424.tar.gz | tar xz

python/bin/python3 -m venv python-env
. python-env/bin/activate
pip install torch numpy requests

cat > python-env/bin/dpython <<EOF
#!/usr/bin/env bash

# source activate

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

source ${DIR}/activate

# run python

${DIR}/python "$@"
EOF

chmod +x python-env/bin/dpython
pushd python-env/bin
rm python3
ln -s ../..python3 python3
