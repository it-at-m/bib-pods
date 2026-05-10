<?php

use BibPods\BibPods\Controller\PodController;
use TYPO3\CMS\Extbase\Utility\ExtensionUtility;

defined('TYPO3') or die;

ExtensionUtility::configurePlugin(
    'BibPods',
    'Pod',
    [PodController::class => 'list'],
    [],
    ExtensionUtility::PLUGIN_TYPE_CONTENT_ELEMENT,
);
