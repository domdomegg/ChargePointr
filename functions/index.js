'use strict'

const DialogflowApp = require('actions-on-google').DialogflowApp;
const functions = require('firebase-functions');
const https = require('https');
const i18n = require('i18n');

i18n.configure({
  locales: ['en', 'fr'],
  directory: __dirname + '/locales',
  defaultLocale: 'en'
});

exports.chargePointr = functions.https.onRequest((request, response) => {
	const app = new DialogflowApp({request: request, response: response});
	i18n.setLocale(app.getUserLocale().substring(0,2));

    function askLocationPermission (app) {
		app.setContext('Nearestchargers-followup');
		app.setContext('charger-levels', 1, {levels: app.getArgument('chargerLevels')});

        app.askForPermission(i18n.__('PERMISSION_REASON'), app.SupportedPermissions.DEVICE_PRECISE_LOCATION);
    }

    function findChargersWithLocation (app) {
		let chargerLevels = (app.getContext('charger-levels') ? app.getContext('charger-levels').parameters.levels : ['1', '2', '3']);

        if (app.isPermissionGranted()) {
            let coordinates = app.getDeviceLocation().coordinates;
			let MAX_RESULTS = '10';

			if (!app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
				MAX_RESULTS = '4';
			}

			let url = 'https://api.openchargemap.io/v2/poi/?output=json&distance=true&usagetypeid=1,4,7,5&verbose=false&statustypeid=10,50,75&latitude=' + coordinates.latitude + '&longitude=' + coordinates.longitude + '&maxresults=' + MAX_RESULTS + '&levelid=' + chargerLevels.join();

            getJSON(url, function (data) {
                let options = [];

                data.forEach(function (charger) {
					if(charger.AddressInfo && charger.Connections[0]) {
						options.push({
							title: charger.AddressInfo.Title,
							description: (getMaxLevelTitle(charger.Connections)) + ', '
										+ (charger.Connections[0].CurrentType ? charger.Connections[0].CurrentType.Title + ', '  : '')
										+ (charger.UsageType.Title.substr(9) ? charger.UsageType.Title.substr(9) + ', ' : '')
										+ charger.AddressInfo.Distance.toString().substr(0, 3) + 'mi',
							selectionKey: charger.ID.toString(),
							synonyms: [charger.AddressInfo.Title.split(/\s+/)[0], charger.AddressInfo.Title.split(/\s+/).slice(0,2).join(' ')]
						});
					}
                });

                let speech = i18n.__('WHICH_CHARGER');
                let title = i18n.__('NEARBY_CHARGERS');

				if (!app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
					speech += ' ';
					options.forEach(function (option) {
						speech += option.title + '. ';
					});
				}

                askWithList(speech, title, options);
            });
        } else {
            askWithLinkAndSuggestions(i18n.__('PERMISSION_FAILED'), 'Open Charge Map', 'https://openchargemap.org/app/', [i18n.__('YES'), i18n.__('NO')]);
        }
    }

    function lookupCharger (app) {
		let url = 'https://api.openchargemap.io/v2/poi/?output=json&verbose=false&chargepointid=' + app.getSelectedOption();

		getJSON(url, function (data) {
			let charger = data[0];

			let speech = i18n.__('CHARGER_HERE_ARE_DETAILS') + ' ' + i18n.__('DIRECTIONS_OR_ATTRIBUTIONS');
			if (!app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
				speech = '<speak>' + i18n.__('THAT_CHARGER_IS') + ' ' + charger.StatusType.Title + ', ' + i18n.__('AND_HAS') + ' ';
				speech += (charger.Connections[0].Quantity ? charger.Connections[0].Quantity + ' ' : '1 '); // 1
				speech += (charger.Connections[0].LevelID ? getLevelTitle(charger.Connections[0].LevelID) + ' ' : ''); // Level 2 : Medium (Over 2kW)
				speech += (charger.Connections[0].ConnectionType ? charger.Connections[0].ConnectionType.Title + ' ' : ''); // Mennekes (Type 2)
				speech += (charger.Connections[0].CurrentType ? charger.Connections[0].CurrentType.Title + ' ' : ''); // AC (Single-Phase)
				speech += (charger.Connections[0].Quantity > 1 ? i18n.__('CONNECTIONS').toLowerCase() + '. ' : i18n.__('CONNECTION').toLowerCase() + '. ');
				speech += i18n.__('ITS_LOCATED_AT') + ' ' + charger.AddressInfo.AddressLine1 + (charger.AddressInfo.Postcode ? ', <say-as interpret-as="digits">' + charger.AddressInfo.Postcode : '') + '</say-as>.';
				speech += i18n.__('EXIT_OR_ATTRIBUTIONS') + '</speak>';
			}

			let title = charger.AddressInfo.Title;
			let destinationName = i18n.__('VIEW_ON_OCM');
			let suggestionUrl = 'https://openchargemap.org/site/poi/details/' + app.getSelectedOption();

			let text = '';

			text += (charger.StatusType.Title ? '**' + i18n.__('STATUS') + ':** ' + charger.StatusType.Title + '  \n' : '');
			text += (charger.AddressInfo.AccessComments ? '**' + i18n.__('ACCESS') + ':** ' + charger.AddressInfo.AccessComments + '  \n' : '');

			text += '**' + i18n.__('ADDRESS') + ':**  \n';
			text += charger.AddressInfo.AddressLine1 + '  \n';
			text += (charger.AddressInfo.AddressLine2 ? charger.AddressInfo.AddressLine2 + '  \n': '');
			text += (charger.AddressInfo.Postcode ? charger.AddressInfo.Postcode + '  \n' : '');

			text += '**' + i18n.__('CONNECTIONS') + ':**  \n';
			charger.Connections.forEach(function (connection) {
				text += (connection.Quantity ? connection.Quantity + 'x ' : '1x '); // 1
				text += (connection.Level ? getLevelTitle(connection.LevelID) + ' ' : ''); // Level 2 : Medium (Over 2kW)
				text += (connection.ConnectionType ? connection.ConnectionType.Title + ' ' : ''); // Mennekes (Type 2)
				text += (connection.CurrentType ? connection.CurrentType.Title : ''); // AC (Single-Phase)
				text += '  \n';
			});

			text += (charger.UsageCost ? '**' + i18n.__('COST') + ':** ' + charger.UsageCost + '  \n': '');
			text += (charger.DataProvider ? '**' + i18n.__('SOURCE') + ':** ' + charger.DataProvider.Title : '');

			app.setContext('charger', 3, charger);
			askWithBasicCardAndLinkAndSuggestions(speech, title, text, destinationName, suggestionUrl, [i18n.__('DIRECTIONS'), i18n.__('ATTRIBUTIONS'), i18n.__('SEARCH_AGAIN'), i18n.__('EXIT')]);
		});
    }

	function getDirections (app) {
		let charger = (app.getContext('charger') ? app.getContext('charger').parameters : {});
		if(app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
			if(charger.AddressInfo) {
				let suggestionUrl = 'https://maps.google.com?saddr=Current+Location&daddr=' + charger.AddressInfo.Latitude.toString() + ',' + charger.AddressInfo.Longitude.toString();

				app.setContext('charger', 3, charger);
				askWithLinkAndSuggestions(i18n.__('OPEN_GOOGLE_MAPS'), 'Google Maps', suggestionUrl, [i18n.__('SEARCH_AGAIN'), i18n.__('EXIT')]);
			} else {
				askSimpleResponseWithSuggestions(i18n.__('SEARCH_CHARGERS_FIRST'), [i18n.__('YES'), i18n.__('NO')]);
			}
		} else {
			app.ask(i18n.__('DIRECTIONS_NOT_SUPPORTED'));
		}
	}

	function getAttributions (app) {
		let charger = app.getContext('charger').parameters;
		if(charger) {
			app.setContext('charger', 3, charger);

			if(charger.DataProvider) {
				let destinationName = charger.DataProvider.Title;
				let suggestionUrl = charger.DataProvider.WebsiteURL;
				let speech = charger.DataProvider.Title + ', ' + charger.DataProvider.License + '. ' + i18n.__('WHAT_ELSE_HELP');

				askWithLinkAndSuggestions(speech, destinationName, suggestionUrl, [i18n.__('SEARCH_AGAIN'), i18n.__('DIRECTIONS'), i18n.__('EXIT')]);
			} else {
				askSimpleResponseWithSuggestions(i18n.__('DATA_MISSING') + ' ' + i18n.__('WHAT_ELSE_HELP'), [i18n.__('SEARCH_AGAIN'), i18n.__('DIRECTIONS'), i18n.__('EXIT')]);
			}
		} else {
			askSimpleResponseWithSuggestions(i18n.__('SEARCH_CHARGERS_FIRST'), [i18n.__('YES'), i18n.__('NO')]);
		}
	}

	const actionMap = new Map();
	actionMap.set('ask_location_permission', askLocationPermission);
	actionMap.set('find_chargers_with_location', findChargersWithLocation);
	actionMap.set('lookup_charger', lookupCharger);
	actionMap.set('get_directions', getDirections);
	actionMap.set('get_attributions', getAttributions);
	app.handleRequest(actionMap);

	function askSimpleResponseWithSuggestions(speech, suggestions) {
        if (app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
            app.ask(app.buildRichResponse()
                .addSimpleResponse(speech)
				.addSuggestions(suggestions)
            );
        } else {
            app.ask(speech);
        }
    }

	function askWithLinkAndSuggestions(speech, destinationName, suggestionUrl, suggestions) {
		if (app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
            app.ask(app.buildRichResponse()
                .addSimpleResponse(speech)
                .addSuggestionLink(destinationName, suggestionUrl)
				.addSuggestions(suggestions)
            );
        } else {
            app.ask(speech);
        }
    }

    function askWithList(speech, title, options) {
		let optionItems = [];
        options.forEach(function (option) {
            optionItems.push(app.buildOptionItem(option.selectionKey, option.synonyms).setTitle(option.title).setDescription(option.description));
        });

        app.askWithList(speech, app.buildList(title).addItems(optionItems));
    }

	function askWithBasicCardAndLinkAndSuggestions(speech, title, text, destinationName, suggestionUrl, suggestions) {
		app.ask(app.buildRichResponse()
			.addSimpleResponse(speech)
			.addBasicCard(app.buildBasicCard(text)
				.setTitle(title)
				.addButton(destinationName, suggestionUrl)
			)
			.addSuggestions(suggestions)
		);
	}
});

function getJSON(url, callback) {
    https.get(url, function(res) {
        let data = '';

        res.on('data', function(chunk) {
            data += chunk;
        });

        res.on('end', function() {
            callback(JSON.parse(data));
        });
    });
}

function getMaxLevelTitle(connections) {
	let maxLevel = 1;

	for (var i = 0; i < connections.length; i++) {
		maxLevel = Math.max(maxLevel, connections[i].LevelID);
	}

	return getLevelTitle(maxLevel);
}

function getLevelTitle(level_number) {
	switch(level_number) {
		case 1: return i18n.__('LEVEL_1');
		case 2: return i18n.__('LEVEL_2');
		case 3: return i18n.__('LEVEL_3');
		default: return '';
	}
}
