//

// Guacamole Codec
export function guacDecode(input: string): string[];
export function guacEncode(...items: string[]): string;

interface JpegInputArgs {
	width: number;
	height: number;
	stride: number; // The width of your input framebuffer OR your image width (if encoding a full image)
	buffer: Buffer;

	// TODO: Allow different formats, or export a boxed ffi object which can store a format
	// (i.e: new JpegEncoder(FORMAT_xxx)).
}

/// Performs JPEG encoding.
export function jpegEncode(input: JpegInputArgs): Promise<Buffer>;

// TODO: Version that can downscale?

/* remoting API?

js side api:

 class RemotingClient extends EventEmitter {
	constructor(uri: string)

	Connect(): Promise<void> - connects to server.

	Disconnect(): void - disconnects from a server.

	get FullScreen(): Buffer - gets the full screen JPEG at a specific moment. This should only be called once
							   during some user-specific setup (for example: when a new user connects)

	get Thumbnail(): Buffer - gets JPEG thumbnail.

	KeyEvent(key: number, pressed: boolean) - sends a key event to the server.
	MouseEvent(x: number, y: number, buttons: MouseButtonMask) - sends a mouse event (the button mask is semi-standardized for remoting,
															the mask can be converted if not applicable for a given protocol)

	// explicit property setter APIs, maybe expose the semi-internal remotingSetProperty API if required?
	set JpegQuality(q: number) - sets JPEG quality

	// events: 

	on('open', cb: () => void) - on open

	//on('firstupdate', cb: (rect: RectWithJpeg) => void) - the first update of a resize is given here
	// doesn't really matter

	on('resize', cb: (size: Size) => void) - when the server resizes we do too.

	on('update', cb: (rects: Array<RectWithJpeg>) => void) - gives screen frame update as jpeg rects
															 (pre-batched using existing batcher or a new invention or something)
	on('close', cb: () => void) - on close

	on('cursor', cb: (b: CursorBitmap) => void) - cursor bitmap changed (always rgba8888)

 }

 binding side API:

	remotingNew("vnc://abc.def:1234") - creates a new remoting client which will use the given protocol in the URI
	xxx for callbacks (they will get migrated to eventemitter or something on the JS side so it's more "idiomatic", depending on performance.
		In all honesty however, remoting will take care of all the performance sensitive tasks, so it probably won't matter at all)

	remotingConnect(client) -> promise<void> (throws rejection) - disconnects
	remotingDisconnect(client) - disconnects
	remotingGetBuffer(client) -> Buffer - gets the buffer used for the screen

	remotingSetProperty(client, propertyId, propertyValue) - sets property (e.g: jpeg quality)
		e.g: server uri could be set after client creation
		with remotingSetProperty(boxedClient, remoting.propertyServerUri, "vnc://another-server.org::2920")

	remotingGetThumbnail(client) - gets thumbnail, this is updated by remoting at about 5 fps

	remotingKeyEvent(client, key, pressed) - key event
	remotingMouseEvent(client, x, y, buttons) - mouse event

 on the rust side a boxed client will contain an inner boxed `dyn RemotingProtocolClient` which will contain protocol specific dispatch,
 upon parsing a remoting URI we will create a given client (e.g: for `vnc://` we'd make the VNC one)
*/
