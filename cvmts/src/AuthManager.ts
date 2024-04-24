import { Logger } from '@cvmts/shared';
import { Rank, User } from './User.js';

export default class AuthManager {
	apiEndpoint: string;
	secretKey: string;

	private logger = new Logger('CVMTS.AuthMan');

	constructor(apiEndpoint: string, secretKey: string) {
		this.apiEndpoint = apiEndpoint;
		this.secretKey = secretKey;
	}

	async Authenticate(token: string, user: User): Promise<JoinResponse> {
		let response = await fetch(this.apiEndpoint + '/api/v1/join', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				secretKey: this.secretKey,
				sessionToken: token,
				ip: user.IP.address
			})
		});

		let json = (await response.json()) as JoinResponse;

		if (!json.success) {
			this.logger.Error(`Failed to query auth server: ${json.error}`);
			process.exit(1);
		}

		return json;
	}
}

interface JoinResponse {
	success: boolean;
	clientSuccess: boolean;
	error: string | undefined;
	username: string | undefined;
	rank: Rank;
}
