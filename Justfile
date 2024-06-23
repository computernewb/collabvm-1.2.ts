all:
	yarn workspace @cvmts/cvm-rs run build
	yarn workspace @computernewb/nodejs-rfb run build
	yarn workspace @cvmts/shared run build
	yarn workspace @cvmts/qemu run build
	yarn workspace @cvmts/cvmts run build

pkg:
	yarn
