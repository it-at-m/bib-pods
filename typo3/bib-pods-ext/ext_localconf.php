<?php

// Solid OIDC redirects back with these query parameters after login.
// TYPO3 must ignore them during cHash validation, otherwise the redirect
// landing page returns a 404 before any JS can process the tokens.
$GLOBALS['TYPO3_CONF_VARS']['FE']['cacheHash']['excludedParameters'][] = 'code';
$GLOBALS['TYPO3_CONF_VARS']['FE']['cacheHash']['excludedParameters'][] = 'state';
$GLOBALS['TYPO3_CONF_VARS']['FE']['cacheHash']['excludedParameters'][] = 'iss';
$GLOBALS['TYPO3_CONF_VARS']['FE']['cacheHash']['excludedParameters'][] = 'session_state';
