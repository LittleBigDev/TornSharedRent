# TornSharedRent

Userscript for [Torn](https://www.torn.com) players who share a home with their spouse. On the page of the home you live in, it shows what each of you paid for it (rent, lease extension, upkeep) and who owes whom.

Work in progress: for now it only detects the home you live in and shows its box there.

## Install

1. Install a userscript manager: [Violentmonkey](https://violentmonkey.github.io/) or Tampermonkey
2. Open [TornSharedRent.user.js](https://raw.githubusercontent.com/LittleBigDev/TornSharedRent/main/TornSharedRent.user.js) and confirm the installation. Updates are automatic.
3. Open the page of your home in Torn, go to the **Settings** tab, follow **Create my key** and save the key.

## Privacy

The script only reads data. It never sends, pays or submits anything for you. Your API key stays in your userscript manager's storage and is only sent to `api.torn.com`. The key it asks for is limited to your property, profile and two log categories (Property, Money sending).
