export default interface VNCVMDef {
	vncHost: string;
	vncPort: number;
	startCmd: string | null;
	stopCmd: string | null;
	rebootCmd: string | null;
	restoreCmd: string | null;
	insertMediaCmd: string | null;
	ejectMediaCmd: string | null;
}
