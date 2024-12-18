const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const green = '\x1b[32m';
const red = '\x1b[31m';
const orange = '\x1b[33m';
const grey = '\x1b[90m';
const blue = '\x1b[34m';
const cyan = '\x1b[35m';
const reset = '\x1b[0m';

class Database
{
	friendList	= {};
	token		= null;

	constructor(token)
	{
		this.token = token;
		fs.mkdir('data/pfp', { recursive: true }, (err) => {
			if (err)
				console.error(err);
			else
			{
				this.db = new sqlite3.Database('./data/database.db', (err) => {
					if (err)
						console.error(err.message);
					else
					{
						this.createTable();
						console.log('[Database] Connected');
					}
				});
			}
		});
	}

	close()
	{
		this.db.close((err) => {
			if (err)
				console.error(err.message);
		});
	}

	createTable()
	{
		this.db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, id_discord TEXT)');
		this.db.run(`
			CREATE TABLE IF NOT EXISTS presence (
				id INTEGER PRIMARY KEY,
				account TEXT,
				device TEXT,
				status TEXT,
				timestamp DATETIME DEFAULT (DATETIME('now', 'localtime')),
				FOREIGN KEY(account) REFERENCES users(id_discord) ON DELETE CASCADE
			)
		`);
		this.db.run(`
			CREATE TABLE IF NOT EXISTS pfp (
				id INTEGER PRIMARY KEY,
				account TEXT,
				path TEXT,
				timestamp DATETIME DEFAULT (DATETIME('now', 'localtime')),
				FOREIGN KEY(account) REFERENCES users(id_discord) ON DELETE CASCADE
			)
		`);
		this.db.run(`
			CREATE TABLE IF NOT EXISTS activity (
				id INTEGER PRIMARY KEY,
				account TEXT,
				activity TEXT,
				start DATETIME,
				end DATETIME,
				FOREIGN KEY(account) REFERENCES users(id_discord) ON DELETE CASCADE
			)
		`);
		this.db.run(`
			CREATE TABLE IF NOT EXISTS custom_status (
				id INTEGER PRIMARY KEY,
				account TEXT,
				start DATETIME,
				end DATETIME,
				text TEXT,
				FOREIGN KEY(account) REFERENCES users(id_discord) ON DELETE CASCADE
			)
		`);
		this.db.run(`
			CREATE TABLE IF NOT EXISTS listen_music (
				id INTEGER PRIMARY KEY,
				account TEXT,
				name TEXT,
				artist TEXT,
				timestamp DATETIME DEFAULT (DATETIME('now', 'localtime')),
				FOREIGN KEY(account) REFERENCES users(id_discord) ON DELETE CASCADE
			)
		`);
	}

	async requester(id)
	{
		const	url = 'https://discord.com/api/v9/users/' + id + '/profile??with_mutual_guilds=true&with_mutual_friends=true&with_mutual_friends_count=false';
		const fetch = (await import('node-fetch')).default;

		return (new Promise((resolve, reject) => {
			fetch(url, {
				method: 'GET',
				headers: {
					'Authorization': this.token,
				}
			}).then((response) => {
				if (response.status === 200)
					resolve(response.json());
				else
					reject(response.status);
			}).catch((err) => {
				reject(err);
			});
		}));
	}


	insertUser(username, id)
	{
		let	thisClass = this;
		let promise = null;

		promise = new Promise((resolve) => {
			this.db.get('SELECT id FROM users WHERE id_discord = ?', [id], (err, row) => {
				if (err)
				{
					console.error(err.message);
					resolve(false);
					return ;
				}
				if (row)
				{
					resolve(false);
					return ;
				}
				else
				{
					this.db.run('INSERT INTO users (username, id_discord) VALUES (?, ?)', [username, id], (err) => {
						if (err)
						{
							console.error(err.message);
							resolve(false);
						}
						else
						{
							console.log(`[Data/User] ${blue}${username}${reset} -> add`);
							resolve(true);
						}
					});
				}
			});
		});
		return (promise);
	}

	insertPresence(account, device, status, isInit = false)
	{
		let	thisClass = this;
		
		function insert()
		{
			thisClass.db.run('INSERT INTO presence (account, device, status) VALUES (?, ?, ?)', [account, device, status], (err) => {
				if (err)
					console.error(err.message);
				else
				{
					let	color = '';

					if (status === 'online')
						color = green;
					else if (status === 'offline')
						color = grey;
					else if (status === 'idle')
						color = orange;
					else
						color = red;
					console.log(`[Data/Status] ${blue}${thisClass.friendList[account].username}${reset} -> ${color}${device}${reset}`);
				}
			});
		}
	
		if (isInit === true)
		{
			this.db.get('SELECT * FROM presence WHERE account = ? AND device = ? ORDER BY timestamp DESC LIMIT 1', [account, device], (err, row) => {
				if (err)
					console.error(err.message);
				else if (row && row.status === status)
					return ;
				else
					insert();
			});
		}
		else
			insert();
	}

	insertPfp(account, avatar)
	{
		let	thisClass = this;

		async function downloadImage(url, filepath)
		{
			const fetch = (await import('node-fetch')).default;
			const response = await fetch(url);
			const fileStream = fs.createWriteStream(filepath);
		
			return (new Promise((resolve, reject) => {
				response.body.pipe(fileStream);
				response.body.on('error', reject);
				fileStream.on('finish', resolve);
			}));
		}

		const		path		= 'data/pfp/' + account + '/' + avatar + '.png';
		
		if (avatar === null)
			return ;
		fs.mkdir('data/pfp/' + account, { recursive: true }, (err) => {
			if (err)
				console.error(err);
			else
			{
				downloadImage('https://cdn.discordapp.com/avatars/' + account + '/' + avatar + '.png?size=1024', path).then(() => {
					this.db.run('INSERT INTO pfp (account, path) VALUES (?, ?)', [account, path], (err) => {
						if (err)
							console.error(err.message);
						else
						{
							if (thisClass.friendList[account] === undefined)
								console.log(`[Data/Pfp] ${blue}${account}${reset} -> new added`);
							else
								console.log(`[Data/Pfp] ${blue}${thisClass.friendList[account].username}${reset} -> new added`);
						}
					});
				}).catch((err) => {
					console.error(err);
				});
			}
		});
	}

	insertCustomActivity(account, text, start, end)
	{
		let		thisClass = this;

		this.getUserLastCustomActivity(account).then((lastCustomActivity) => {
			if (lastCustomActivity !== undefined && lastCustomActivity !== null && lastCustomActivity.text === text) 
			{
				this.db.run('UPDATE custom_status SET end = ? WHERE account = ? AND text = ?', [end, account, text], (err) => {
					if (err)
						console.error(err.message);
					else
						console.log(`[Data/Custom Activity] ${blue}${thisClass.friendList[account].username}${reset} -> '${cyan}${text}${reset}' reloaded`);
				});
				return ;
			}
			if (text === null || text === '' || text === undefined)
				return ;
			this.db.run('INSERT INTO custom_status (account, text, start, end) VALUES (?, ?, ?, ?)', [account, text, start, end], (err) => {
				if (err)
					console.error(err.message);
				else
					console.log(`[Data/Custom Activity] ${blue}${thisClass.friendList[account].username}${reset} -> '${cyan}${text}${reset}' added`);
			});
		});
	}

	insertActivity(account, activity, start, end)
	{
		let	thisClass = this;

		this.db.run('INSERT INTO activity (account, activity, start, end) VALUES (?, ?, ?, ?)', [account, activity, start, end], (err) => {
			if (err)
				console.error(err.message);
			else
				console.log(`[Data/Activity] ${blue}${thisClass.friendList[account].username}${reset} -> '${cyan}${activity}${reset}' added`);
		});
	}

	insertMusic(account, name, artist)
	{
		let	thisClass = this;

		this.db.run('INSERT INTO listen_music (account, name, artist) VALUES (?, ?, ?)', [account, name, artist], (err) => {
			if (err)
				console.error(err.message);
			else
				console.log(`[Data/Music] ${blue}${thisClass.friendList[account].username}${reset} -> ${cyan}${name}${reset} by ${cyan}${artist}${reset}`);
		});
	}

	getUserPresence(user_id)
	{
		let	promise = null;
		
		promise = new Promise((resolve) => {
			this.db.all('SELECT * FROM presence WHERE account = ?', [user_id], (err, rows) => {
				if (err)
				{
					console.error(err.message);
					resolve(null);
				}
				else
					resolve(rows);
			});
		});
		return (promise);
	}

	getLastPfp(user_id)
	{
		let	promise = null;

		promise = new Promise((resolve) => {
			this.db.get('SELECT path FROM pfp WHERE account = ? ORDER BY timestamp DESC LIMIT 1', [user_id], (err, row) => {
				if (err)
				{
					console.error(err.message);
					resolve(null);
				}
				else
					resolve(row);
			});
		});
		return (promise);
	}

	getUserAllPfp(user_id)
	{
		let	promise = null;

		promise = new Promise((resolve) => {
			this.db.all('SELECT * FROM pfp WHERE account = ?', [user_id], (err, rows) => {
				if (err)
				{
					console.error(err.message);
					resolve(null);
				}
				else
					resolve(rows);
			});
		});
		return (promise);
	}

	getUserActivity(user_id)
	{
		let	promise = null;

		promise = new Promise((resolve) => {
			this.db.all('SELECT * FROM activity WHERE account = ?', [user_id], (err, rows) => {
				if (err)
				{
					console.error(err.message);
					resolve(null);
				}
				else
					resolve(rows);
			});
		});
		return (promise);
	}

	getUserLastCustomActivity(user_id)
	{
		let	promise = null;

		promise = new Promise((resolve) => {
			this.db.get('SELECT * FROM custom_status WHERE account = ? ORDER BY start DESC LIMIT 1', [user_id], (err, row) => {
				if (err)
				{
					console.error(err.message);
					resolve(null);
				}
				else
					resolve(row);
			});
		});
		return (promise);
	}

	getUserCustomActivity(user_id)
	{
		let	promise = null;

		promise = new Promise((resolve) => {
			this.db.all('SELECT * FROM custom_status WHERE account = ?', [user_id], (err, rows) => {
				if (err)
				{
					console.error(err.message);
					resolve(null);
				}
				else
					resolve(rows);
			});
		});
		return (promise);
	}

	getUserListenMusic(user_id)
	{
		let	promise	= null;
		let limit	= 50;

		promise = new Promise((resolve) => {
			this.db.all('SELECT * FROM listen_music WHERE account = ? ORDER BY timestamp DESC LIMIT ?', [user_id, limit], (err, rows) => {
				if (err)
				{
					console.error(err.message);
					resolve(null);
				}
				else
					resolve(rows);
			});
		});
		return (promise);
	}

	getListUserByNickname(nickname)
	{
		let	promise = null;

		promise = new Promise((resolve) => {
			this.db.all('SELECT * FROM users WHERE username LIKE ?', ['%' + nickname + '%'], (err, rows) => {
				if (err)
				{
					console.error(err.message);
					resolve(null);
				}
				else
					resolve(rows);
			});
		});
		return (promise);
	}

	getTableCount(tableName)
	{
		let promise = null;

		promise = new Promise((resolve) => {
			this.db.get(`SELECT COUNT(*) as count FROM ${tableName}`, (err, row) => {
				if (err)
				{
					console.error(err.message);
					resolve(null);
				}
				else
					resolve(row.count);
			});
		});
		return (promise);
	}

	getRawData(type, range)
	{
		switch (type)
		{
			case 'activitys':
				return (new Promise((resolve) => {
					this.db.all('SELECT * FROM activity ORDER BY id DESC LIMIT ? OFFSET ?', [range[1] - range[0], range[0]], (err, rows) => {
						if (err)
						{
							console.error(err.message);
							resolve(null);
						}
						else
						{
							this.getTableCount('activity').then((count) => {
								resolve({data: rows, nb: count});
							});
						}
					});
				}));
			case 'customs_status':
				return (new Promise((resolve) => {
					this.db.all('SELECT * FROM custom_status ORDER BY id DESC LIMIT ? OFFSET ?', [range[1] - range[0], range[0]], (err, rows) => {
						if (err)
						{
							console.error(err.message);
							resolve(null);
						}
						else
						{
							this.getTableCount('custom_status').then((count) => {
								resolve({data: rows, nb: count});
							});
						}
					});
				}));
			case 'musics':
				return (new Promise((resolve) => {
					this.db.all('SELECT * FROM listen_music ORDER BY id DESC LIMIT ? OFFSET ?', [range[1] - range[0], range[0]], (err, rows) => {
						if (err)
						{
							console.error(err.message);
							resolve(null);
						}
						else
						this.getTableCount('listen_music').then((count) => {
							resolve({data: rows, nb: count});
						});
					});
				}));
			case 'pfps':
				return (new Promise((resolve) => {
					this.db.all('SELECT * FROM pfp ORDER BY id DESC LIMIT ? OFFSET ?', [range[1] - range[0], range[0]], (err, rows) => {
						if (err)
						{
							console.error(err.message);
							resolve(null);
						}
						else
						{
							this.getTableCount('pfp').then((count) => {
								resolve({data: rows, nb: count});
							});
						}
					});
				}));
			case 'presences':
				return (new Promise((resolve) => {
					this.db.all('SELECT * FROM presence ORDER BY id DESC LIMIT ? OFFSET ?', [range[1] - range[0], range[0]], (err, rows) => {
						if (err)
						{
							console.error(err.message);
							resolve(null);
						}
						else
						{
							this.getTableCount('presence').then((count) => {
								resolve({data: rows, nb: count});
							});
						}
					});
				}));
			case 'users':
				return (new Promise((resolve) => {
					this.db.all('SELECT * FROM users LIMIT ? OFFSET ?', [range[1] - range[0], range[0]], (err, rows) => {
						if (err)
						{
							console.error(err.message);
							resolve(null);
						}
						else
						{
							this.getTableCount('users').then((count) => {
								resolve({data: rows.sort((a, b) => a.username.localeCompare(b.username)), nb: count});
							});
						}
					});
				}));
			default:
				return (new Promise((resolve) => {resolve(null)}));
		}
	}
}

module.exports.Database = Database;