<?php

declare(strict_types=1);

namespace BibPods\BibPods\Controller;

use Psr\Http\Message\ResponseInterface;
use TYPO3\CMS\Extbase\Mvc\Controller\ActionController;

final class PodController extends ActionController
{
    public function listAction(): ResponseInterface
    {
        return $this->htmlResponse();
    }
}
