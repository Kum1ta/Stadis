const WebSocket = require('ws');
const gatewayUrl = 'wss://gateway.discord.gg/?v=10&encoding=json';

const green = '\x1b[32m';
const reset = '\x1b[0m';

class Discord
{
	websocket = null;
	token = null;
	bufferInfo = [];
	bufferPresence = {};
	bufferCustomActivity = [];
	bufferMusic = [];
	db = null;
	selfInfo = null;
	isReallyClosed = false;
	alreadyInit = false;
	lastFiveMusic = [];
	lastFiveStatus = [];
	timeStart = new Date();

	constructor(database, token)
	{
		this.db = database;
		this.token = token;
		this.isNotValidToken(token).then(() => {
			console.log('[Discord] Connection to Discord WebSocket...');
			this.connect();
		}).catch(() => {
			console.log('[Discord] Invalid token, please check it in secret.json');
			database.close();
			process.exit(1);
		});
	}

	isNotValidToken(token)
	{
		return new Promise((resolve, reject) => {
			fetch('https://discord.com/api/v10/users/@me', {
				method: 'GET',
				headers: {
					'Authorization': token,
				}
			}).then((response) => {
				if (response.ok)
					resolve();
				else
					reject();
			}).catch((err) => {
				reject();
			});
		});
	}

	connect()
	{
		this.websocket = new WebSocket(gatewayUrl);
		const	thisClass = this;

		this.websocket.on('open', () => {
			console.log('[Discord] WebSocket connected');
			const identifyPayload = {
				op: 2,
				intents: 131071,
				d: {
					token: thisClass.token,
					properties: {
						$os: 'linux',
						$browser: 'firefox',
						$device: 'desktop',
						$system_locale: 'fr-FR',
						$browser_version: '118.0',
						$os_version: 'Ubuntu 22.04',
						$referrer: '',
						$referring_domain: '',
						$release_channel: 'stable',
					},
					presence: {
						status: 'offline',
					}
				}
			};
			this.websocket.send(JSON.stringify(identifyPayload));
		});

		this.websocket.on('message', (data) => {
			const message = JSON.parse(data);

			if (message.op === 10)
			{
				const interval = message.d.heartbeat_interval;
				setInterval(() => {
					this.websocket.send(JSON.stringify({ op: 1, d: null }));
				}, interval);
			}
			else
				this.action(message);
		});

		this.websocket.on('close', () => {
			thisClass.websocket = null;
			if (!thisClass.isReallyClosed)
			{
				console.log('Reconnecting...');
				thisClass.connect();
			}
		});
	}

	action(message)
	{
		if (message.t === 'READY')
			this.#readyEvent(message);
		else if (message.t === 'PRESENCE_UPDATE')
			this.#presenceUpdate(message);
		else if (message.t === 'RELATIONSHIP_REMOVE')
		{
			for (let i = 0; i < this.bufferInfo.length; i++)
			{
				if (this.bufferInfo[i].id === message.d.id)
				{
					this.bufferInfo.splice(i, 1);
					break;
				}
			}
		}
		else if (message.t === 'RELATIONSHIP_ADD')
			this.bufferInfo.push({username: message.d.user.username, id: message.d.user.id, pfp: message.d.user.avatar, activities: []});
		else
		{
			try {
				if (!message.d || this.bufferInfo.findIndex((element) => element.id === message.d.user_id) === -1)
					return ;
			}
			catch (e) {
				console.log("------------------ERROR------------------");
				console.log(message);
				console.log(e);
				return ;
			}
			console.log("---------------------------------------------");
			console.log("Unknown event : " + message.t);
			console.log("---------------------------------------------");
		}
	}

	#readyEvent(message)
	{
		const	peopleNotReallyOffline = [];

		if (this.alreadyInit)
			return ;
		this.alreadyInit = true;
		this.selfInfo = message.d.user;
		console.log(`[Discord] Connected as ${green}${this.selfInfo.username}${reset}`);
		this.db.getLastPfp(this.selfInfo.id).then((userPfp) => {
			if (userPfp && 'data/pfp/' + this.selfInfo.id + '/' + this.selfInfo.avatar + '.png' === userPfp.path)
				return ;
			this.db.insertPfp(this.selfInfo.id, this.selfInfo.avatar);
		});
		setTimeout(() => {
			if (this && this.websocket)
				this.websocket.send(JSON.stringify({ op: 3, d: { status: 'idle', since: new Date(), activities: [], status: 'afk', afk: true } }));
		}, 5000);
		for (let i = 0; i < message.d.presences.length; i++)
		{
			const	presence = message.d.presences[i];
			let		web, mobile, desktop;

			web = presence.client_status.web ? presence.client_status.web : "offline";
			mobile = presence.client_status.mobile ? presence.client_status.mobile : "offline";
			desktop = presence.client_status.desktop ? presence.client_status.desktop : "offline";
			if (web !== "offline")
				this.db.insertPresence(presence.user.id, "web", web, true);
			if (mobile !== "offline")
				this.db.insertPresence(presence.user.id, "mobile", mobile, true);
			if (desktop !== "offline")
				this.db.insertPresence(presence.user.id, "desktop", desktop, true);
			this.bufferPresence[presence.user.id] = {web: web, mobile: mobile, desktop: desktop};
			if (this.bufferPresence[presence.user.id].web === "offline" && this.bufferPresence[presence.user.id].mobile === "offline" && this.bufferPresence[presence.user.id].desktop === "offline")
			{
				this.bufferPresence[presence.user.id].isNotReallyOffline = true;
				peopleNotReallyOffline.push(presence.user.username);
			}
			else
				this.bufferPresence[presence.user.id].isNotReallyOffline = false;
		}
		console.log("[Data/Status] These people are not really offline");
		for (let i = 0; i < peopleNotReallyOffline.length; i += 4) {
			console.log("   " + peopleNotReallyOffline.slice(i, i + 4).join(', '));
		}
		for (let i = 0; i < message.d.relationships.length; i++)
		{
			this.bufferInfo.push({username: message.d.relationships[i].user.username, id: message.d.relationships[i].user.id, pfp: message.d.relationships[i].user.avatar, activities: []});
			this.db.friendList[message.d.relationships[i].user.id] = {username: message.d.relationships[i].user.username};
			if (this.bufferPresence[message.d.relationships[i].user.id] === undefined)
			{
				this.db.insertPresence(message.d.relationships[i].user.id, "web", "offline", true);
				this.db.insertPresence(message.d.relationships[i].user.id, "mobile", "offline", true);
				this.db.insertPresence(message.d.relationships[i].user.id, "desktop", "offline", true);
				this.bufferPresence[message.d.relationships[i].user.id] = {web: "offline", mobile: "offline", desktop: "offline"};
			}
			this.db.insertUser(message.d.relationships[i].user.username, message.d.relationships[i].user.id).then((bool) => {
				if (!bool)
				{
					this.db.getLastPfp(message.d.relationships[i].user.id).then((userPfp) => {
						if (userPfp === null)
							return ;
						if (userPfp === undefined || userPfp.length === 0)
							this.db.insertPfp(message.d.relationships[i].user.id, message.d.relationships[i].user.avatar);
						else
						{
							if (userPfp.path !== "data/pfp/" + message.d.relationships[i].user.id + "/" + message.d.relationships[i].user.avatar + ".png")
								this.db.insertPfp(message.d.relationships[i].user.id, message.d.relationships[i].user.avatar);
						}
					});
					return ;
				}
				if (message.d.relationships[i].user.avatar !== undefined)
					this.db.insertPfp(message.d.relationships[i].user.id, message.d.relationships[i].user.avatar);
			});
		}
	}

	#presenceUpdate(message)
	{
		let	index = -1;

		const pfpChange = () =>
		{
			if (message.d.user.avatar !== undefined)
			{
				if (this.bufferInfo[index].pfp === message.d.user.avatar)
					return ;
				this.bufferInfo[index].pfp = message.d.user.avatar;
				this.db.insertPfp(message.d.user.id, message.d.user.avatar);
			}
		}

		const statusChange = () =>
		{
			for (let i = 0; i < this.bufferInfo.length; i++)
			{
				if (this.bufferInfo[i].id === message.d.user.id)
				{
					index = i;
					break;
				}
			}
			if (index === -1)
				return ;
			if (this.bufferPresence[message.d.user.id])
			{
				const	oldStatus				= this.bufferPresence[message.d.user.id];
				let		web, mobile, desktop;

				web = message.d.client_status.web ? message.d.client_status.web : "offline";
				mobile = message.d.client_status.mobile ? message.d.client_status.mobile : "offline";
				desktop = message.d.client_status.desktop ? message.d.client_status.desktop : "offline";
				if (web !== oldStatus.web)
					this.db.insertPresence(this.bufferInfo[index].id, "web", web);
				if (mobile !== oldStatus.mobile)
					this.db.insertPresence(this.bufferInfo[index].id, "mobile", mobile);
				if (desktop !== oldStatus.desktop)
					this.db.insertPresence(this.bufferInfo[index].id, "desktop", desktop);
				this.bufferPresence[message.d.user.id].web = web;
				this.bufferPresence[message.d.user.id].mobile = mobile;
				this.bufferPresence[message.d.user.id].desktop = desktop;

				const user = this.lastFiveStatus.includes(message.d.user.id) ? this.lastFiveStatus[this.lastFiveStatus.indexOf(message.d.user.id)] : null;
				if (user && user.data.web === web && user.data.mobile === mobile && user.data.desktop === desktop)
					return ;
				if (this.lastFiveStatus.length && this.lastFiveStatus[this.lastFiveStatus.length - 1].id === message.d.user.id)
				{
					this.lastFiveStatus.splice(this.lastFiveStatus.length - 1, 1)
					this.lastFiveStatus.push({id: message.d.user.id, data: this.bufferPresence[message.d.user.id]});
				}
				else
				{
					if (this.lastFiveStatus.length === 5)
						this.lastFiveStatus.shift();
					this.lastFiveStatus.push({id: message.d.user.id, data: this.bufferPresence[message.d.user.id]});
				}
			}
			else
			{
				this.bufferPresence[message.d.user.id] = {web: message.d.client_status.web ? message.d.client_status.web : "offline", mobile: message.d.client_status.mobile ? message.d.client_status.mobile : "offline", desktop: message.d.client_status.desktop ? message.d.client_status.desktop : "offline"};
				this.db.insertPresence(this.bufferInfo[index].id, "web", message.d.client_status.web ? message.d.client_status.web : "offline");
				this.db.insertPresence(this.bufferInfo[index].id, "mobile", message.d.client_status.mobile ? message.d.client_status.mobile : "offline");
				this.db.insertPresence(this.bufferInfo[index].id, "desktop", message.d.client_status.desktop ? message.d.client_status.desktop : "offline");
			}
		}

		const activitiesChange = () =>
		{
			const	gameAct = (activity) =>
			{
				for (let i = 0; i < this.bufferInfo[index].activities.length; i++)
				{
					if (this.bufferInfo[index].activities[i].name === activity.name)
						return ;
				}
				this.bufferInfo[index].activities.push({type: activity.type, name: activity.name, start: new Date(), end: null});
			}

			const	musicAct = (activity) =>
			{
				for (let i = 0; i < this.bufferMusic.length; i++)
				{
					if (this.bufferMusic[i].id === message.d.user.id)
					{
						if (this.bufferMusic[i].name === activity.details && this.bufferMusic[i].artist === activity.state)
							return ;
						this.bufferMusic[i].name = activity.details;
						this.bufferMusic[i].artist = activity.state;
						if (this.bufferMusic[i].name === null || this.bufferMusic[i].name === undefined || this.bufferMusic[i].artist === null || this.bufferMusic[i].artist === undefined)
							return ;
						if (this.bufferMusic[i].name === "" || this.bufferMusic[i].artist === "")
							return ;
						if (this.lastFiveMusic.length === 5)
							this.lastFiveMusic.shift();
						this.lastFiveMusic.push({name: this.bufferMusic[i].name, artist: this.bufferMusic[i].artist, id: this.bufferMusic[i].id});
						this.db.insertMusic(this.bufferMusic[i].id, this.bufferMusic[i].name, this.bufferMusic[i].artist);
						return ;
					}
				}
				if (this.lastFiveMusic.length === 5)
					this.lastFiveMusic.shift();
				this.lastFiveMusic.push({name: activity.details, artist: activity.state, id: message.d.user.id});
				this.bufferMusic.push({id: message.d.user.id, name: activity.details, artist: activity.state});
				this.db.insertMusic(message.d.user.id, activity.details, activity.state);
			}

			const	customAct = (activity) =>
			{
				for (let i = 0; i < this.bufferCustomActivity.length; i++)
				{
					if (this.bufferCustomActivity[i].id === message.d.user.id)
					{
						if (this.bufferCustomActivity[i].state === activity.state)
							return ;
						this.db.insertCustomActivity(this.bufferCustomActivity[i].id, this.bufferCustomActivity[i].state, this.bufferCustomActivity[i].start, new Date());
						this.bufferCustomActivity[i].state = activity.state;
						this.bufferCustomActivity[i].start = new Date();
						return ;
					}
				}
				this.bufferCustomActivity.push({id: message.d.user.id, state: activity.state, start: new Date()});
			}

			const	activityEnd = (activity) =>
			{
				for (let i = 0; i < this.bufferInfo[index].activities.length; i++)
				{
					if (this.bufferInfo[index].activities[i].name === activity.name)
					{
						this.bufferInfo[index].activities[i].end = new Date();
						if (activity.type === 0)
							this.db.insertActivity(this.bufferInfo[index].id, this.bufferInfo[index].activities[i].name, this.bufferInfo[index].activities[i].start, this.bufferInfo[index].activities[i].end);
						this.bufferInfo[index].activities.splice(i, 1);
						return ;
					}
				}
			}

			for (let i = 0; i < message.d.activities.length; i++)
			{
				if (message.d.activities[i].type === 0)
					gameAct(message.d.activities[i]);
				else if (message.d.activities[i].type === 2)
					musicAct(message.d.activities[i]);
				else if (message.d.activities[i].type === 4)
					customAct(message.d.activities[i]);
			}
			for (let i = 0; i < this.bufferInfo[index].activities.length; i++)
			{
				let	found = false;

				if (this.bufferInfo[index].activities[i].type === 0)
				{
					for (let j = 0; j < message.d.activities.length; j++)
					{
						if (this.bufferInfo[index].activities[i].name === message.d.activities[j].name)
						{
							found = true;
							break;
						}
					}
					if (!found && this.bufferInfo[index].activities[i])
						activityEnd(this.bufferInfo[index].activities[i]);
				}
			}
			for (let i = 0; i < this.bufferCustomActivity.length; i++)
			{
				let	foundCustomActivity = false;

				for (let j = 0; j < message.d.activities.length; j++)
				{
					if (message.d.activities[j].type === 4)
					{
						foundCustomActivity = true;
						break;
					}
				}
				if (!foundCustomActivity)
				{
					for (let j = 0; j < this.bufferCustomActivity.length; j++)
					{
						if (this.bufferCustomActivity[j].id === message.d.user.id)
						{
							this.db.insertCustomActivity(this.bufferCustomActivity[j].id, this.bufferCustomActivity[j].state, this.bufferCustomActivity[j].start, new Date());
							this.bufferCustomActivity.splice(j, 1);
							break;
						}
					}
				}

			}
		}
		statusChange();
		if (index === -1)
		{
			// console.log("User not found : " + message.d.user.id + " (not in friend list)");
			return ;
		}
		pfpChange();
		activitiesChange();
	}

	finish()
	{
		this.isReallyClosed = true;
		this.websocket.close();
		this.websocket = null;
		Object.values(this.bufferInfo).forEach((user) => {
			user.activities.forEach((activity) => {
				this.db.insertActivity(user.id, activity.name, activity.start, activity.end);
			});
		});
		Object.entries(this.bufferPresence).forEach(([userId, status]) => {
			if (status.web !== "offline")
				this.db.insertPresence(userId, "web", "offline");
			if (status.mobile !== "offline")
				this.db.insertPresence(userId, "mobile", "offline");
			if (status.desktop !== "offline")
				this.db.insertPresence(userId, "desktop", "offline");
		});
		Object.values(this.bufferCustomActivity).forEach((activity) => {
			if (activity.state !== null)
				this.db.insertCustomActivity(activity.id, activity.state, activity.start, Date.now());
		});
	}
}

module.exports = { Discord };
