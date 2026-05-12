<?php

$EM_CONF[$_EXTKEY] = [
    'title' => 'bib-pods',
    'description' => 'bib-pods Solid integration',
    'category' => 'plugin',
    'state' => 'alpha',
    'author' => 'Benjamin Degenhart',
    'author_email' => 'benjamin.degenhart@digital-at-m.de',
    'version' => '0.1.0',
    'constraints' => [
        'depends' => [
            'typo3' => '13.4.0-13.4.99',
        ],
    ],
    'autoload' => [
        'psr-4' => [
            'BibPods\\BibPods\\' => 'Classes/',
        ],
    ],
];
