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

		// Make sure the fetch returned okay
		if (!response.ok) throw new Error(`Failed to query quth server: ${response.statusText}`);

		let json = (await response.json()) as JoinResponse;

		if (!json.success) throw new Error(json.error);

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
