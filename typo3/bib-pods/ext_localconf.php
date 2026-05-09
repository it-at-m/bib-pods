<?php

defined('TYPO3') or die();

\TYPO3\CMS\Extbase\Utility\ExtensionUtility::configurePlugin(
    'BibPods',
    'Pod',
    [\BibPods\BibPods\Controller\PodController::class => 'list']
);
