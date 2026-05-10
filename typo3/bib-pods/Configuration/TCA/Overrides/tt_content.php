<?php

use TYPO3\CMS\Extbase\Utility\ExtensionUtility;

defined('TYPO3') or die;

ExtensionUtility::registerPlugin(
    'BibPods',
    'Pod',
    'LLL:EXT:bib_pods/Resources/Private/Language/locallang_be.xlf:plugin.pod.title',
    null,
    'plugins',
    'LLL:EXT:bib_pods/Resources/Private/Language/locallang_be.xlf:plugin.pod.description',
);
