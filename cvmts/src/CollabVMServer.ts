import IConfig from './IConfig.js';
import { User } from './User.js';
import AuthManager from './AuthManager.js';
import { ReaderModel } from '@maxmind/geoip2-node';
import pino from 'pino';
import { BanManager } from './BanManager.js';
import { IProtocolMessageHandler, ProtocolUpgradeCapability } from './protocol/Protocol.js';
import { TheProtocolManager } from './protocol/Manager.js';
import { CollabVMNode } from './CollabVMNode.js';

export default class CollabVMServer implements IProtocolMessageHandler {
	private Config: IConfig;

	// Authentication manager
	public auth: AuthManager | null;
	// Geoip
	public geoipReader: ReaderModel | null;
	// Ban manager
	public banmgr: BanManager;

	private logger = pino({ name: 'CVMTS.Server' });

	private nodes;

	constructor(config: IConfig, banmgr: BanManager, auth: AuthManager | null, geoipReader: ReaderModel | null, nodes: Map<String, CollabVMNode>) {
		this.Config = config;
		this.nodes = nodes;

		// assertions are always a good thing to have
		if (this.Config.auth.enabled == true && auth == null) throw new Error('Authentication manager must not be null if CVMAuth is enabled');

		if (this.Config.geoip.enabled == true && geoipReader == null) throw new Error('GeoIP reader must not be null if GeoIP is enabled');

		// assign managers now that we have them
		this.auth = auth;
		this.geoipReader = geoipReader;
		this.banmgr = banmgr;
	}

	async Start() {
		let promises = [...this.nodes.values()].map((node) => node.Start());
		await Promise.allSettled(promises);
		this.logger.info('All nodes started');
	}

	async Stop() {
		let promises = [...this.nodes.values()].map((node) => node.Stop());
		await Promise.allSettled(promises);
		this.logger.info('All nodes stopped, shutting down');
	}

	public connectionOpened(user: User) {
		if (this.Config.geoip.enabled && this.geoipReader) {
			try {
				let countryModel = this.geoipReader.country(user.IP.address);
				if (countryModel.country == null) throw new Error('Country model has no country record for this IP address');

				user.countryCode = countryModel.country.isoCode;
			} catch (error) {
				this.logger.warn(
					{
						failed_ip: user.IP.address,
						error
					},
					`Failed to get country code from GeoIP database`
				);
			}
		}

		user.socket.on('msg', (buf: Buffer, binary: boolean) => {
			try {
				if (user.processMessage(this, buf) == false) {
					this.logger.error(
						{
							ip: user.IP.address,
							username: user.username,
							protocol_in_use: Object.getPrototypeOf(user.protocol).constructor?.name
						},
						'Soft error processing a protocol message.'
					);
					user.kick();
				}
			} catch (err) {
				this.logger.error(
					{
						ip: user.IP.address,
						username: user.username,
						error_message: (err as Error).message,
						protocol_in_use: Object.getPrototypeOf(user.protocol).constructor?.name
					},
					'Error when processing a protocol message.'
				);
				user.kick();
			}
		});

		user.socket.on('disconnect', () => this.connectionClosed(user));

		if (this.Config.auth.enabled) {
			user.sendAuth(this.Config.auth.apiEndpoint);
		}
	}

	private connectionClosed(user: User) {
		this.logger.info(
			{
				ip: user.IP.address,
				username: user.username,
				node: user.Node?.getNodeId()
			},
			'User disconnected from server'
		);

		if (user.connectedToNode) {
			user.Node?.removeUser(user);
		}
	}

	// Protocol message handlers
	onNop(user: User): void {
		user.onNop();
	}

	async onLogin(user: User, token: string) {
		if (!this.Config.auth.enabled) return;

		if (!user.connectedToNode) {
			user.sendLoginResponse(false, 'You must connect to the VM before logging in.');
			return;
		}

		await user.Node?.onLogin(user, token);
	}

	onNoFlag(user: User) {
		// Too late
		if (user.connectedToNode) return;
		user.noFlag = true;
	}

	onCapabilityUpgrade(user: User, capability: String[]): boolean {
		if (user.connectedToNode) return false;

		let enabledCaps: ProtocolUpgradeCapability[] = [];

		let addCap = (cap: ProtocolUpgradeCapability) => {
			enabledCaps.push(cap);
			user.negotiatedCapabilities.add(cap);
		};

		for (let cap of capability) {
			switch (cap) {
				// binary 1.0 (msgpack rects)
				case ProtocolUpgradeCapability.BinRects:
					addCap(cap as ProtocolUpgradeCapability);
					user.protocol = TheProtocolManager.getProtocol('binary1');
					break;
				case ProtocolUpgradeCapability.ExtendedList:
					addCap(cap as ProtocolUpgradeCapability);
					break;
				default:
					break;
			}
		}

		user.sendCapabilities(enabledCaps);
		return true;
	}

	onTurnRequest(user: User, forfeit: boolean): void {
		if (!user.connectedToNode) return;

		user.Node?.onTurnRequest(user, forfeit);
	}

	onVote(user: User, choice: number): void {
		if (!user.connectedToNode) return;
		user.Node?.onVote(user, choice);
	}

	async onList(user: User) {
		let listPromises = [...this.nodes.values()]
			.filter((node) => node.isVMStarted())
			.map(async (node) => {
				return await node.getListEntry();
			});

		user.sendListResponse(await Promise.all(listPromises));
	}

	private async connectViewShared(user: User, node: string, viewMode: number | undefined) {
		// get the fuck off my lawn pissboy
		if (user.connectedToNode) return;

		if (viewMode !== undefined) {
			if (viewMode !== 0 && viewMode !== 1) {
				return user.sendConnectFailResponse();
			}

			user.viewMode = viewMode;
		}

		let maybeNode = this.nodes.get(node);
		if (maybeNode == undefined) {
			return user.sendConnectFailResponse();
		}

		maybeNode.addUser(user);

		this.logger.info(
			{
				ip: user.IP.address,
				username: user.username,
				node: maybeNode.getNodeId()
			},
			'User connected to node'
		);
	}

	async onConnect(user: User, node: string) {
		return this.connectViewShared(user, node, undefined);
	}

	async onView(user: User, node: string, viewMode: number) {
		return this.connectViewShared(user, node, viewMode);
	}

	onRename(user: User, newName: string | undefined): void {
		if (!user.connectedToNode) {
			user.username = newName;
			return;
		}
		user.Node?.onRename(user, newName);
	}

	onChat(user: User, message: string): void {
		if (!user.connectedToNode) return;
		user.Node?.onChat(user, message);
	}

	onKey(user: User, keysym: number, pressed: boolean): void {
		if (!user.connectedToNode) return;
		user.Node?.onKey(user, keysym, pressed);
	}

	onMouse(user: User, x: number, y: number, buttonMask: number): void {
		if (!user.connectedToNode) return;
		user.Node?.onMouse(user, x, y, buttonMask);
	}

	async onAdminLogin(user: User, password: string) {
		if (!user.connectedToNode) return;
		user.Node?.onAdminLogin(user, password);
	}

	async onAdminMonitor(user: User, node: string, command: string) {
		if (!user.connectedToNode) return;
		user.Node?.onAdminMonitor(user, node, command);
	}

	onAdminRestore(user: User, node: string): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminRestore(user, node);
	}

	async onAdminReboot(user: User, node: string) {
		if (!user.connectedToNode) return;
		user.Node?.onAdminReboot(user, node);
	}

	async onAdminBanUser(user: User, username: string) {
		if (!user.connectedToNode) return;
		user.Node?.onAdminBanUser(user, username);
	}

	onAdminForceVote(user: User, choice: number): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminForceVote(user, choice);
	}

	onAdminMuteUser(user: User, username: string, temporary: boolean): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminMuteUser(user, username, temporary);
	}

	onAdminKickUser(user: User, username: string): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminKickUser(user, username);
	}

	onAdminEndTurn(user: User, username: string): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminEndTurn(user, username);
	}

	onAdminClearQueue(user: User, node: string): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminClearQueue(user, node);
	}

	onAdminRename(user: User, target: string, newName: string): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminRename(user, target, newName);
	}

	onAdminGetIP(user: User, username: string): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminGetIP(user, username);
	}

	onAdminBypassTurn(user: User): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminBypassTurn(user);
	}

	onAdminRawMessage(user: User, message: string): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminRawMessage(user, message);
	}

	onAdminToggleTurns(user: User, enabled: boolean): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminToggleTurns(user, enabled);
	}

	onAdminIndefiniteTurn(user: User): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminIndefiniteTurn(user);
	}

	async onAdminHideScreen(user: User, show: boolean) {
		if (!user.connectedToNode) return;
		user.Node?.onAdminHideScreen(user, show);
	}

	onAdminSystemMessage(user: User, message: string): void {
		if (!user.connectedToNode) return;
		user.Node?.onAdminSystemMessage(user, message);
	}

	// end protocol message handlers
}
