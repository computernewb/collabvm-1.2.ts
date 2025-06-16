export default interface VNCVMDef {
	vncHost: string;
	vncPort: number;
	startCmd?: string;
	stopCmd?: string;
	rebootCmd?: string;
	restoreCmd?: string;
}
