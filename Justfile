all:
	yarn workspace @cvmts/cvm-rs run build
	yarn workspace @cvmts/collab-vm-1.2-binary-protocol run build
	yarn workspace @cvmts/cvmts run build

pkg:
	yarn
