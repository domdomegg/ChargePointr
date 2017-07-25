'use strict'

const ApiAiApp = require('actions-on-google').ApiAiApp;
const functions = require('firebase-functions');
const https = require('https');
const dashbot = require('dashbot')('fC1GphoDWue8172wjcpSEFv1MXF4h7aemj3hxGBn').google;

exports.chargePointr = functions.https.onRequest((request, response) => {
	const app = new ApiAiApp({request: request, response: response});

    function askLocationPermission (app) {
		app.setContext('Nearestchargers-followup');
        app.askForPermission("To find the nearest chargers",
        	app.SupportedPermissions.DEVICE_PRECISE_LOCATION);
    }

    function findChargersWithLocation (app) {
		// let chargerLevels = ['1', '2', '3'];

        if (app.isPermissionGranted()) {
            let coordinates = app.getDeviceLocation().coordinates;

			let url = 'https://api.openchargemap.io/v2/poi/?output=json&maxresults=10&distance=true&usagetypeid=1,4,7,5&verbose=false&statustypeid=10,50,75&latitude=' + coordinates.latitude + '&longitude=' + coordinates.longitude;// + '&levelid=' + chargerLevels.join();

            getJSON(url, function (data) {
                let options = [];

                data.forEach(function (charger) {
					if(charger.AddressInfo && charger.Connections[0]) {
						options.push({
							title: charger.AddressInfo.Title,
							description: charger.Connections[0].Level.Title + ', '
										+ (charger.Connections[0].CurrentType ? charger.Connections[0].CurrentType.Title + ', '  : '')
										+ (charger.UsageType.Title.substr(9) ? charger.UsageType.Title.substr(9) + ', ' : '')
										+ charger.AddressInfo.Distance.toString().substr(0, 3) + 'mi',
							selectionKey: charger.ID.toString(),
							synonyms: [charger.AddressInfo.Title.split(/\s+/)[0], charger.AddressInfo.Title.split(/\s+/).slice(0,2).join(' ')]
						});
					}
                });

                let speech = 'Which of these chargers looks good?';
                let title = 'Nearby chargers';

				if (!app.hasSurfaceCapability(app.SurfaceCapabilities.SCREEN_OUTPUT)) {
					speech += ' ';
					options.forEach(function (option) {
						speech += option.title + '. ';
					});
				}

                askWithList(speech, title, options);
            });
        } else {
            askWithLinkAndSuggestions('Unfortunately I can\'t find charge points near you without your location. Do you want to try again?', 'Open Charge Map', 'http://openchargemap.org/app/', ['Yes', 'No']);
        }
    }

    function lookupCharger (app) {
		let url = 'https://api.openchargemap.io/v2/poi/?output=json&verbose=false&chargepointid=' + app.getSelectedOption();

		getJSON(url, function (data) {
			let charger = data[0];
			let speech = "Here are the details for that charger: ";
			let title = charger.AddressInfo.Title;
			let destinationName = 'View on Open Charge Map';
			let suggestionUrl = 'https://openchargemap.org/site/poi/details/' + app.getSelectedOption();
			let text = '';

			text += (charger.StatusType.Title ? '**Status:** ' + charger.StatusType.Title + '  \n' : '');
			text += (charger.AddressInfo.AccessComments ? '**Acess:** ' + charger.AddressInfo.AccessComments + '  \n' : '');

			text += '**Address:**  \n';
			text += charger.AddressInfo.AddressLine1 + '  \n';
			text += (charger.AddressInfo.AddressLine2 ? charger.AddressInfo.AddressLine2 + '  \n': '');
			text += (charger.AddressInfo.Postcode ? charger.AddressInfo.Postcode + '  \n' : '');

			text += '**Connections:**  \n';
			charger.Connections.forEach(function (connection) {
				text += (connection.Quantity ? connection.Quantity + 'x ' : ''); // 1
				text += (connection.Level ? connection.Level.Title + ' ' : ''); // Level 2 : Medium (Over 2kW)
				text += (connection.ConnectionType ? connection.ConnectionType.Title + ' ' : ''); // Mennekes (Type 2)
				text += (connection.CurrentType ? connection.CurrentType.Title : ''); // AC (Single-Phase)
				text += '  \n';
			});

			text += (charger.UsageCost ? '**Cost:** ' + charger.UsageCost + '  \n': '');
			text += (charger.DataProvider ? '**Source:** ' + charger.DataProvider.Title : '');

			app.setContext('charger', 3, charger);
			askWithBasicCardAndLinkAndSuggestions(speech, title, text, destinationName, suggestionUrl, ['Get directions', 'Attributions', 'Search again', 'Thanks, bye']);
		});
    }

	function getDirections (app) {
		let charger = (app.getContext('charger') ? app.getContext('charger').parameters : {});
		if(charger.AddressInfo) {
			let suggestionUrl = 'https://maps.google.com?saddr=Current+Location&daddr=' + charger.AddressInfo.Latitude.toString() + ',' + charger.AddressInfo.Longitude.toString();

			app.setContext('charger', 3, charger);
			askWithLinkAndSuggestions('Sure, here\'s directions on Google Maps', 'Google Maps', suggestionUrl, ['Search again', 'Exit']);
		} else {
			askSimpleResponseWithSuggestions('Sorry, you need to search for chargers first', ['Find chargers', 'Exit']);
		}
	}

	function getAttributions (app) {
		let charger = app.getContext('charger').parameters;
		if(charger) {
			app.setContext('charger', 3, charger);

			if(charger.DataProvider) {
				let destinationName = charger.DataProvider.Title;
				let suggestionUrl = charger.DataProvider.WebsiteURL;
				let speech = 'Data by ' + charger.DataProvider.Title + ', ' + charger.DataProvider.License;

				askWithLinkAndSuggestions(speech, destinationName, suggestionUrl, ['Find other chargers', 'Get directions', 'Thanks, bye']);
			} else {
				askSimpleResponseWithSuggestions('Data provider information is missing for that charger.', ['Find other chargers', 'Thanks, bye']);
			}
		} else {
			askSimpleResponseWithSuggestions('Sorry, you need to search for chargers first', ['Find chargers', 'Exit']);
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
		dashbot.logOutgoing(app.getRawInput(), speech);

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
		dashbot.logOutgoing(app.getRawInput(), speech);

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
		dashbot.logOutgoing(app.getRawInput(), speech);

        let optionItems = [];
        options.forEach(function (option) {
            optionItems.push(app.buildOptionItem(option.selectionKey, option.synonyms).setTitle(option.title).setDescription(option.description));
        });

        app.askWithList(speech, app.buildList(title).addItems(optionItems));
    }

	function askWithBasicCardAndLinkAndSuggestions(speech, title, text, destinationName, suggestionUrl, suggestions) {
		dashbot.logOutgoing(app.getRawInput(), speech);

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
    let req = https.get(url, function(res) {
        let data = '';

        res.on('data', function(chunk) {
            data += chunk;
        });

        res.on('end', function() {
            callback(JSON.parse(data));
        });
    });
}

function randomFromArray(arr) {
	return arr[Math.floor(Math.random() * arr.length)];
}
